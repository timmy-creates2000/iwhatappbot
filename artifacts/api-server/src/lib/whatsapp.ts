import { logger } from "./logger";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eq, inArray } from "drizzle-orm";
import { db, groupsTable, groupLogsTable } from "@workspace/db";

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const WA_AUTH_DIR = path.resolve(_dirname, "../../.wa-auth");

interface WhatsAppStatusData {
  connected: boolean;
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
}

export interface GroupInfo {
  id: string;
  subject: string;
  participants: Array<{ id: string; admin?: string | null }>;
}

interface GroupUpdate {
  id: string;
  subject?: string;
  participants?: Array<{ id: string; admin?: string | null }>;
}

interface WAMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

interface WASocketLike {
  user?: { id?: string; name?: string };
  ev: {
    on(event: "creds.update", handler: () => void): void;
    on(event: "connection.update", handler: (update: {
      connection?: string;
      lastDisconnect?: { error?: unknown };
      qr?: string;
    }) => void): void;
    on(event: "groups.upsert", handler: (groups: GroupInfo[]) => void): void;
    on(event: "groups.update", handler: (updates: GroupUpdate[]) => void): void;
  };
  logout(): Promise<void>;
  groupFetchAllParticipating(): Promise<Record<string, GroupInfo>>;
  groupParticipantsUpdate(id: string, participants: string[], action: string): Promise<unknown>;
  groupLeave(groupId: string): Promise<unknown>;
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
}

export function toJid(phone: string): string {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return `${digits}@s.whatsapp.net`;
}

// ── Group DB helpers ───────────────────────────────────────────────────────────

async function upsertGroups(groups: GroupInfo[]): Promise<void> {
  for (const g of groups) {
    await db
      .insert(groupsTable)
      .values({
        groupId: g.id,
        name: g.subject,
        memberCount: g.participants?.length ?? null,
      })
      .onConflictDoUpdate({
        target: groupsTable.groupId,
        set: {
          name: g.subject,
          memberCount: g.participants?.length ?? null,
        },
      });
  }
}

// ── WhatsApp Service ──────────────────────────────────────────────────────────

class WhatsAppService {
  private sock: WASocketLike | null = null;
  private qr: string | null = null;
  private status: WhatsAppStatusData = {
    connected: false,
    status: "disconnected",
    phoneNumber: null,
    displayName: null,
  };

  private initPromise: Promise<void> | null = null;
  private _intentionalLogout = false;

  // Reconnect backoff — reset to 0 after any stable connection (>30s uptime)
  private _reconnectAttempt = 0;
  private _connectedSince: number | null = null;

  getStatus(): WhatsAppStatusData {
    return this.status;
  }

  getQR(): string | null {
    return this.qr;
  }

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this._intentionalLogout = false;
    this.initPromise = this._connect();
    return this.initPromise;
  }

  private async _connect(): Promise<void> {
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
        logger: logger.child({ module: "baileys", level: "silent" }) as unknown as Parameters<typeof makeWASocket>[0]["logger"],

        // ── Connection stability settings ───────────────────────────────────
        // Ping every 25s — WhatsApp drops silent connections after ~30s
        keepAliveIntervalMs: 25_000,
        // Give the initial handshake up to 60s before giving up
        connectTimeoutMs: 60_000,
        // Retry failed queries quickly
        retryRequestDelayMs: 250,
        // Don't advertise presence — reduces server-side timeouts for bots
        markOnlineOnConnect: false,
        // Don't request full message history — reduces initial load
        syncFullHistory: false,
        // Required by Baileys for message retry logic; return undefined = no cache
        getMessage: async (_key: WAMessageKey) => undefined,
      } as Parameters<typeof makeWASocket>[0]) as unknown as WASocketLike;

      this.sock = sock;
      sock.ev.on("creds.update", saveCreds);

      // ── Connection lifecycle ──────────────────────────────────────────────
      sock.ev.on("connection.update", async (update) => {
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

        if (connection === "open") {
          this.qr = null;
          this._intentionalLogout = false;
          this._connectedSince = Date.now();
          this._reconnectAttempt = 0; // stable connection — reset backoff

          const user = sock.user;
          this.status = {
            connected: true,
            status: "connected",
            phoneNumber: user?.id?.split(":")[0] ?? null,
            displayName: user?.name ?? null,
          };
          logger.info({ phoneNumber: this.status.phoneNumber }, "WhatsApp connected");

          // Full group sync once on connect, then events keep DB in sync
          this._initialGroupSync().catch((e: unknown) =>
            logger.error({ err: e }, "Initial group sync failed")
          );
        }

        if (connection === "close") {
          const boom = lastDisconnect?.error as InstanceType<typeof Boom> | undefined;
          const statusCode = boom?.output?.statusCode;

          // If last connection was stable (>30s), reset backoff for next attempt
          if (this._connectedSince && Date.now() - this._connectedSince > 30_000) {
            this._reconnectAttempt = 0;
          }
          this._connectedSince = null;

          this.sock = null;
          this.qr = null;
          this.status = {
            connected: false,
            status: "disconnected",
            phoneNumber: null,
            displayName: null,
          };

          logger.info(
            { statusCode, intentionalLogout: this._intentionalLogout },
            "Connection closed"
          );

          if (this._intentionalLogout) {
            logger.info("Intentional logout — not reconnecting");
            return;
          }

          // ── Decide how to handle each disconnect reason ──────────────────

          if (statusCode === DisconnectReason.loggedOut) {
            // User logged out from phone — clear session, show QR on next visit
            logger.info("Logged out from WhatsApp — clearing session");
            this.clearAuthFiles();
            this.initPromise = null;
            return;
          }

          if (statusCode === DisconnectReason.forbidden) {
            // Account restricted/banned — do not hammer with reconnects
            logger.warn("Connection forbidden (account may be restricted) — not reconnecting");
            this.clearAuthFiles();
            this.initPromise = null;
            return;
          }

          if (statusCode === DisconnectReason.connectionReplaced) {
            // Another WhatsApp Web session opened — the other session won, don't fight it
            logger.warn("Connection replaced by another session — not reconnecting");
            this.initPromise = null;
            return;
          }

          if (statusCode === DisconnectReason.badSession) {
            // Corrupted session files — wipe them and start fresh with QR
            logger.warn("Bad session — clearing auth and resetting");
            this.clearAuthFiles();
            this.initPromise = null;
            return;
          }

          // restartRequired → reconnect immediately (no delay)
          // connectionLost / connectionClosed / timedOut / multideviceMismatch → backoff
          const delayMs = statusCode === DisconnectReason.restartRequired
            ? 0
            : Math.min(3_000 * Math.pow(2, this._reconnectAttempt), 120_000);

          this._reconnectAttempt++;

          logger.info(
            { delayMs, attempt: this._reconnectAttempt, statusCode },
            "Reconnecting after disconnect"
          );

          setTimeout(() => {
            this.initPromise = this._connect();
          }, delayMs);
        }
      });

      // ── Real-time group events ────────────────────────────────────────────

      sock.ev.on("groups.upsert", (groups) => {
        if (!groups.length) return;
        upsertGroups(groups)
          .then(() => logger.info({ count: groups.length }, "groups.upsert synced"))
          .catch((err: unknown) => logger.error({ err }, "groups.upsert DB error"));
      });

      sock.ev.on("groups.update", (updates) => {
        const relevant = updates.filter(
          (u) => u.subject !== undefined || u.participants !== undefined
        );
        if (!relevant.length) return;

        Promise.all(
          relevant.map((u) =>
            db
              .update(groupsTable)
              .set({
                ...(u.subject !== undefined ? { name: u.subject } : {}),
                ...(u.participants !== undefined ? { memberCount: u.participants.length } : {}),
              })
              .where(eq(groupsTable.groupId, u.id))
          )
        )
          .then(() => logger.info({ count: relevant.length }, "groups.update synced"))
          .catch((err: unknown) => logger.error({ err }, "groups.update DB error"));
      });

    } catch (err) {
      logger.warn({ err }, "Baileys failed to initialize — WhatsApp features disabled");
      this.status = {
        connected: false,
        status: "unavailable",
        phoneNumber: null,
        displayName: null,
      };
    }
  }

  /**
   * Full sync on first connect — upserts all current groups and cleans up
   * stale DB rows. After this, real-time events keep everything in sync.
   */
  private async _initialGroupSync(): Promise<void> {
    const groups = await this.fetchGroups();
    if (!groups) return;

    await upsertGroups(groups);

    const waIds = new Set(groups.map((g) => g.id));
    const existing = await db.select().from(groupsTable);
    const stale = existing.filter(
      (r) => !r.groupId.startsWith("local-") && !waIds.has(r.groupId)
    );
    if (stale.length > 0) {
      const staleIds = stale.map((r) => r.id);
      await db.delete(groupLogsTable).where(inArray(groupLogsTable.groupId, staleIds));
      await db.delete(groupsTable).where(inArray(groupsTable.id, staleIds));
    }

    logger.info(
      { total: groups.length, removed: stale.length },
      "Initial group sync complete"
    );
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
    this._connectedSince = null;
    this._reconnectAttempt = 0;
    this.status = {
      connected: false,
      status: "disconnected",
      phoneNumber: null,
      displayName: null,
    };

    this.clearAuthFiles();
    logger.info("Logged out — session cleared.");
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
