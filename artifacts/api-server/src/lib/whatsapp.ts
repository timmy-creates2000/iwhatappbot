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
  groupMetadata(groupId: string): Promise<GroupInfo>;
  groupParticipantsUpdate(id: string, participants: string[], action: string): Promise<Array<{ status: string; jid: string }>>;
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

  // Accumulated from groups.upsert events — covers ALL groups (no 50-cap).
  // groupFetchAllParticipating() is capped at ~50 by WhatsApp's protocol, so
  // we rely on these events for a complete picture.
  private _groupCache = new Map<string, GroupInfo>();

  getStatus(): WhatsAppStatusData {
    return this.status;
  }

  getCacheSize(): number {
    return this._groupCache.size;
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
        // Populate cache — covers all groups including those beyond the 50-cap
        // of groupFetchAllParticipating. WhatsApp streams every group the user
        // belongs to through this event during the initial connection handshake.
        for (const g of groups) {
          this._groupCache.set(g.id, g);
        }
        upsertGroups(groups)
          .then(() => logger.info({ count: groups.length, cacheSize: this._groupCache.size }, "groups.upsert synced"))
          .catch((err: unknown) => logger.error({ err }, "groups.upsert DB error"));
      });

      sock.ev.on("groups.update", (updates) => {
        const relevant = updates.filter(
          (u) => u.subject !== undefined || u.participants !== undefined
        );
        if (!relevant.length) return;

        // Keep cache in sync so manual sync reflects latest group state
        for (const u of relevant) {
          const cached = this._groupCache.get(u.id);
          if (cached) {
            this._groupCache.set(u.id, {
              ...cached,
              ...(u.subject !== undefined ? { subject: u.subject } : {}),
              ...(u.participants !== undefined ? { participants: u.participants } : {}),
            });
          }
        }

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
   * Full sync on first connect — waits for WhatsApp to stream all groups via
   * groups.upsert events (which have no cap), then upserts the full cache to DB.
   *
   * We intentionally do NOT delete stale rows here because
   * groupFetchAllParticipating() is hard-capped at ~50 groups by WhatsApp's
   * protocol — using it for deletion would wrongly remove groups 51+.
   * The groups.upsert event stream covers every group, so the DB naturally
   * stays in sync as real-time events arrive.
   */
  private async _initialGroupSync(): Promise<void> {
    // Give Baileys time to receive the full groups.upsert stream from WhatsApp.
    // The stream is usually complete within a few seconds but we wait 15s to be
    // safe for accounts with many groups.
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    const cached = Array.from(this._groupCache.values());

    if (cached.length === 0) {
      // Cache is empty — fall back to the direct API call as a best-effort.
      // This will only return up to ~50 groups but is better than nothing.
      const fetched = await this.fetchGroups();
      if (fetched && fetched.length > 0) {
        await upsertGroups(fetched);
        logger.info({ total: fetched.length }, "Initial group sync complete (API fallback)");
      } else {
        logger.warn("Initial group sync skipped — no groups received from WhatsApp");
      }
      return;
    }

    await upsertGroups(cached);
    logger.info({ total: cached.length }, "Initial group sync complete");
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
    this._groupCache.clear();
    this.status = {
      connected: false,
      status: "disconnected",
      phoneNumber: null,
      displayName: null,
    };

    this.clearAuthFiles();
    logger.info("Logged out — session cleared.");
  }

  /**
   * Returns all groups from the in-memory cache (populated via groups.upsert
   * events — no 50-group cap). Falls back to groupFetchAllParticipating() if
   * the cache is empty. Returns null when not connected.
   */
  async fetchAllGroups(): Promise<GroupInfo[] | null> {
    if (!this.sock || !this.status.connected) return null;
    if (this._groupCache.size > 0) {
      const cached = Array.from(this._groupCache.values());
      logger.info({ total: cached.length }, "Returning groups from cache");
      return cached;
    }
    // Cache empty — fall back to direct API (capped at ~50 by WhatsApp)
    return this.fetchGroups();
  }

  /**
   * Direct API call — hard-capped at ~50 groups by WhatsApp's protocol.
   * Prefer fetchAllGroups() which uses the uncapped event cache.
   */
  async fetchGroups(): Promise<GroupInfo[] | null> {
    if (!this.sock || !this.status.connected) return null;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const allGroups = Object.values(groups);
      logger.info({ total: allGroups.length }, "Fetched groups via API (capped at ~50)");
      return allGroups;
    } catch (err) {
      logger.error({ err }, "Failed to fetch groups");
      return null;
    }
  }

  /**
   * Adds a participant to a group. Returns the WhatsApp status code:
   *   "200" = success
   *   "403" = forbidden (bot is not admin, or privacy settings block it)
   *   "408" = number not registered on WhatsApp
   *   "409" = participant already in the group
   * Throws only on network/connection errors.
   */
  async addToGroup(groupId: string, participantJid: string): Promise<string> {
    if (!this.sock || !this.status.connected) {
      throw new Error("Not connected to WhatsApp");
    }
    const results = await this.sock.groupParticipantsUpdate(groupId, [participantJid], "add");
    // results is an array — one entry per participant
    return results[0]?.status ?? "200";
  }

  /**
   * Fetches the full participant list for a specific group.
   * Tries the in-memory cache first (populated by groups.upsert events),
   * then falls back to a live groupMetadata() call.
   */
  async getGroupParticipants(groupId: string): Promise<GroupInfo["participants"] | null> {
    if (!this.sock || !this.status.connected) return null;
    // Try cache first
    const cached = this._groupCache.get(groupId);
    if (cached?.participants && cached.participants.length > 0) {
      return cached.participants;
    }
    // Live fetch
    try {
      const meta = await this.sock.groupMetadata(groupId);
      return meta.participants ?? [];
    } catch (err) {
      logger.error({ err, groupId }, "groupMetadata failed");
      return null;
    }
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
