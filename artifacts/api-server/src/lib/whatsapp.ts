import { logger } from "./logger";
import fs from "fs";

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

/** Normalize phone to JID: strip leading +, append @s.whatsapp.net */
export function toJid(phone: string): string {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return `${digits}@s.whatsapp.net`;
}

class WhatsAppService {
  private sock: unknown = null;
  private qr: string | null = null;
  private status: WhatsAppStatusData = {
    connected: false,
    status: "disconnected",
    phoneNumber: null,
    displayName: null,
  };

  // Use a promise so concurrent initialize() calls all wait on the same init
  private initPromise: Promise<void> | null = null;

  getStatus(): WhatsAppStatusData {
    return this.status;
  }

  getQR(): string | null {
    return this.qr;
  }

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._connect(0);
    return this.initPromise;
  }

  private async _connect(attempt: number): Promise<void> {
    try {
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
      } = await import("@whiskeysockets/baileys");
      const { Boom } = await import("@hapi/boom");

      const { state, saveCreds } = await useMultiFileAuthState(".wa-auth");

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: logger.child({
          module: "baileys",
        }) as unknown as Parameters<typeof makeWASocket>[0]["logger"],
      });

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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            this.sock = null;
            this.qr = null;
            this.status = {
              connected: false,
              status: "disconnected",
              phoneNumber: null,
              displayName: null,
            };

            logger.info({ shouldReconnect, statusCode }, "Connection closed");

            if (shouldReconnect) {
              // Exponential backoff: 5s, 10s, 20s, 40s … capped at 5 minutes
              const nextAttempt = attempt + 1;
              const delayMs = Math.min(5000 * Math.pow(2, attempt), 300_000);
              logger.info({ delayMs, nextAttempt }, "Reconnecting after delay");
              setTimeout(() => {
                this.initPromise = this._connect(nextAttempt);
              }, delayMs);
            } else {
              // Logged out — wipe session so next init shows a fresh QR
              this.clearAuthFiles();
              this.initPromise = null;
              // Auto-start fresh connection so QR is ready immediately
              setTimeout(() => {
                this.initPromise = this._connect(0);
              }, 1000);
            }
          }

          if (connection === "open") {
            this.qr = null;
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
      fs.rmSync(".wa-auth", { recursive: true, force: true });
      logger.info("Cleared .wa-auth session directory");
    } catch (err) {
      logger.warn({ err }, "Failed to clear .wa-auth directory");
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.sock) {
        const sock = this.sock as { logout: () => Promise<void> };
        await sock.logout();
      }
    } catch (err) {
      logger.warn({ err }, "Logout error");
    }
    this.sock = null;
    this.qr = null;
    this.initPromise = null;
    this.status = {
      connected: false,
      status: "disconnected",
      phoneNumber: null,
      displayName: null,
    };
    // Wipe saved session so next scan is always a fresh number
    this.clearAuthFiles();
    // Auto-start so QR is ready immediately after disconnect
    setTimeout(() => {
      this.initPromise = this._connect(0);
    }, 500);
  }

  async fetchGroups(): Promise<GroupInfo[] | null> {
    if (!this.sock || !this.status.connected) return null;
    try {
      const sock = this.sock as {
        groupFetchAllParticipating: () => Promise<Record<string, GroupInfo>>;
      };
      const groups = await sock.groupFetchAllParticipating();
      const myPhone = this.status.phoneNumber;

      // Only return groups where the connected number is admin or superadmin
      const adminGroups = Object.values(groups).filter((g) => {
        if (!myPhone) return false;
        // Participant IDs can be bare JID or device-suffixed (e.g. 2347061201898:5@s.whatsapp.net)
        const me = g.participants.find((p) => p.id.startsWith(myPhone));
        return me?.admin === "admin" || me?.admin === "superadmin";
      });

      logger.info(
        { total: Object.keys(groups).length, adminOnly: adminGroups.length },
        "Filtered groups to admin-only",
      );
      return adminGroups;
    } catch (err) {
      logger.error({ err }, "Failed to fetch groups");
      return null;
    }
  }

  async addToGroup(groupId: string, participantJid: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    const sock = this.sock as {
      groupParticipantsUpdate: (
        id: string,
        participants: string[],
        action: string,
      ) => Promise<unknown>;
    };
    await sock.groupParticipantsUpdate(groupId, [participantJid], "add");
  }

  async removeFromGroup(groupId: string, participantJid: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    const sock = this.sock as {
      groupParticipantsUpdate: (
        id: string,
        participants: string[],
        action: string,
      ) => Promise<unknown>;
    };
    await sock.groupParticipantsUpdate(groupId, [participantJid], "remove");
  }

  async deleteGroup(groupId: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    const sock = this.sock as {
      groupLeave: (groupId: string) => Promise<unknown>;
    };
    // Note: WhatsApp API can only leave groups, not delete them permanently
    // This removes the bot from the group
    await sock.groupLeave(groupId);
    logger.info({ groupId }, "Left WhatsApp group");
  }

  async refreshQR(): Promise<void> {
    if (this.status.connected) {
      throw new Error("Already connected. Disconnect first to generate a new QR code.");
    }
    // Force a new connection attempt which will generate a fresh QR
    await this.logout();
    this.initPromise = null;
    await this.initialize();
  }

  async sendMessage(jid: string, message: string): Promise<void> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    const sock = this.sock as {
      sendMessage: (
        jid: string,
        content: { text: string },
      ) => Promise<unknown>;
    };
    await sock.sendMessage(jid, { text: message });
  }
}

export const whatsappService = new WhatsAppService();
