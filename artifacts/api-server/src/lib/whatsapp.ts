import { logger } from "./logger";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve .wa-auth relative to the workspace root, not cwd
// In dev (tsx): __dirname = src/, workspace root = ../../
// In prod (dist): __dirname = dist/, workspace root = ../../
const _dirname = path.dirname(fileURLToPath(import.meta.url));
const WA_AUTH_DIR = path.resolve(_dirname, "../../.wa-auth");

interface WhatsAppStatusData {
  connected: boolean;
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
}

interface GroupInfo {
  id: string;
  subject: string;
  participants: Array<{ id: string; admin?: string | null }>;
}

/** Minimal typed interface for the Baileys WASocket we actually use */
interface WASocketLike {
  user?: { id?: string; name?: string };
  ev: {
    on(event: "creds.update", handler: () => void): void;
    on(event: "connection.update", handler: (update: {
      connection?: string;
      lastDisconnect?: { error?: unknown };
      qr?: string;
    }) => void): void;
  };
  logout(): Promise<void>;
  groupFetchAllParticipating(): Promise<Record<string, GroupInfo>>;
  groupParticipantsUpdate(id: string, participants: string[], action: string): Promise<unknown>;
  groupLeave(groupId: string): Promise<unknown>;
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
}

/** Normalize phone to JID: strip leading +, append @s.whatsapp.net */
export function toJid(phone: string): string {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return `${digits}@s.whatsapp.net`;
}

class WhatsAppService {
  private sock: WASocketLike | null = null;
  private qr: string | null = null;
  private status: WhatsAppStatusData = {
    connected: false,
    status: "disconnected",
    phoneNumber: null,
    displayName: null,
  };

  // Use a promise so concurrent initialize() calls all wait on the same init
  private initPromise: Promise<void> | null = null;

  // Flag set during intentional logout — prevents auto-reconnect
  private _intentionalLogout = false;

  getStatus(): WhatsAppStatusData {
    return this.status;
  }

  getQR(): string | null {
    return this.qr;
  }

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this._intentionalLogout = false;
    this.initPromise = this._connect(0);
    return this.initPromise;
  }

  private async _connect(attempt: number): Promise<void> {
    // Don't reconnect if user intentionally logged out
    if (this._intentionalLogout) return;

    try {
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
      } = await import("@whiskeysockets/baileys");
      const { Boom } = await import("@hapi/boom");

      const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: logger.child({
          module: "baileys",
        }) as unknown as Parameters<typeof makeWASocket>[0]["logger"],
      }) as unknown as WASocketLike;

      this.sock = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on(
        "connection.update",
        async (update: {
          connection?: string;
          lastDisconnect?: { error?: unknown };
          qr?: string;
        }) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            try {
              const QRCode = await import("qrcode");
              this.qr = await QRCode.default.toDataURL(qr);
              this.status = { ...this.status, status: "qr_ready" };
              logger.info("QR code generated");
            } catch {
              this.qr = null;
            }
          }

          if (connection === "close") {
            const boom = lastDisconnect?.error as InstanceType<typeof Boom> | undefined;
            const statusCode = boom?.output?.statusCode;

            this.sock = null;
            this.qr = null;
            this.status = {
              connected: false,
              status: "disconnected",
              phoneNumber: null,
              displayName: null,
            };

            logger.info({ statusCode, intentionalLogout: this._intentionalLogout }, "Connection closed");

            // Don't reconnect if user intentionally logged out
            if (this._intentionalLogout) {
              logger.info("Intentional logout — not reconnecting");
              return;
            }

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
              // Exponential backoff: 5s, 10s, 20s, 40s … capped at 5 minutes
              const nextAttempt = attempt + 1;
              const delayMs = Math.min(5000 * Math.pow(2, attempt), 300_000);
              logger.info({ delayMs, nextAttempt }, "Reconnecting after delay");
              setTimeout(() => {
                this.initPromise = this._connect(nextAttempt);
              }, delayMs);
            } else {
              // WhatsApp-side logout — wipe session so next init shows fresh QR
              this.clearAuthFiles();
              this.initPromise = null;
              logger.info("Logged out from WhatsApp side — session cleared");
            }
          }

          if (connection === "open") {
            this.qr = null;
            this._intentionalLogout = false;
            const user = sock.user;
            this.status = {
              connected: true,
              status: "connected",
              phoneNumber: user?.id?.split(":")[0] ?? null,
              displayName: user?.name ?? null,
            };
            logger.info({ phoneNumber: this.status.phoneNumber }, "WhatsApp connected");
          }
        },
      );
    } catch (err) {
      logger.warn(
        { err },
        "Baileys not available or failed to initialize — WhatsApp features disabled",
      );
      this.status = {
        connected: false,
        status: "unavailable",
        phoneNumber: null,
        displayName: null,
      };
    }
  }

  private clearAuthFiles(): void {
    try {
      fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
      logger.info({ path: WA_AUTH_DIR }, "Cleared .wa-auth session directory");
    } catch (err) {
      logger.warn({ err }, "Failed to clear .wa-auth directory");
    }
  }

  async logout(): Promise<void> {
    // Set flag FIRST so connection.update handler doesn't auto-reconnect
    this._intentionalLogout = true;
    this.initPromise = null;

    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (err) {
      logger.warn({ err }, "Logout error (socket already closed)");
    }

    this.sock = null;
    this.qr = null;
    this.status = {
      connected: false,
      status: "disconnected",
      phoneNumber: null,
      displayName: null,
    };

    // Wipe session files so old number can't reconnect
    this.clearAuthFiles();

    logger.info("Logged out — session cleared. Call initialize() to connect a new number.");
  }

  async fetchGroups(): Promise<GroupInfo[] | null> {
    if (!this.sock || !this.status.connected) return null;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const allGroups = Object.values(groups);
      logger.info({ total: allGroups.length }, "Fetched all participating groups");
      return allGroups;
    } catch (err) {
      logger.error({ err }, "Failed to fetch groups");
      return null;
    }
  }

  async addToGroup(groupId: string, participantJid: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    await this.sock.groupParticipantsUpdate(groupId, [participantJid], "add");
  }

  async removeFromGroup(groupId: string, participantJid: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    await this.sock.groupParticipantsUpdate(groupId, [participantJid], "remove");
  }

  /**
   * Leaves a WhatsApp group (removes the bot from the group).
   * Note: WhatsApp does not allow programmatic group deletion — this only
   * removes the connected account from the group.
   */
  async leaveGroup(groupId: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    await this.sock.groupLeave(groupId);
    logger.info({ groupId }, "Left WhatsApp group");
  }

  /** @deprecated Use leaveGroup() */
  async deleteGroup(groupId: string): Promise<void> {
    return this.leaveGroup(groupId);
  }

  async refreshQR(): Promise<void> {
    if (this.status.connected) {
      throw new Error("Already connected. Disconnect first to generate a new QR code.");
    }
    this._intentionalLogout = false;
    this.initPromise = null;
    await this.initialize();
  }

  async sendMessage(jid: string, message: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    await this.sock.sendMessage(jid, { text: message });
  }
}

export const whatsappService = new WhatsAppService();
