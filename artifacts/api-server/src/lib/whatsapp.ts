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
  authState?: { creds?: { registered?: boolean } };
  ev: {
    on(event: "creds.update", handler: () => void): void;
    on(event: "connection.update", handler: (update: {
      connection?: string;
      lastDisconnect?: { error?: unknown };
      qr?: string;
    }) => void): void;
    on(event: "groups.upsert", handler: (groups: GroupInfo[]) => void): void;
    on(event: "groups.update", handler: (updates: GroupUpdate[]) => void): void;
    on(event: "group-participants.update", handler: (update: {
      id: string;
      participants: string[];
      action: string;
    }) => void): void;
  };
  end(error?: Error): void;
  logout(): Promise<void>;
  groupFetchAllParticipating(): Promise<Record<string, GroupInfo>>;
  groupMetadata(groupId: string): Promise<GroupInfo>;
  groupParticipantsUpdate(id: string, participants: string[], action: string): Promise<Array<{ status: string; jid: string }>>;
  groupLeave(groupId: string): Promise<unknown>;
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  requestPairingCode(phone: string): Promise<string>;
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
  private _pairingCode: string | null = null;
  private _pairingError: string | null = null;
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

  // Tracks participants who left or were removed per group (groupId → Set<jid>).
  // Persists for the lifetime of the server process so the add-contacts job
  // can skip re-adding people who voluntarily left.
  private _leftParticipants = new Map<string, Set<string>>();

  getStatus(): WhatsAppStatusData {
    return this.status;
  }

  getCacheSize(): number {
    return this._groupCache.size;
  }

  getQR(): string | null {
    return this.qr;
  }

  getPairingCode(): string | null {
    return this._pairingCode;
  }

  /**
   * Returns the set of JIDs that have previously left or been removed from a
   * specific group. Used by the add-contacts job to avoid re-adding people.
   */
  getPreviouslyLeft(groupId: string): Set<string> {
    return this._leftParticipants.get(groupId) ?? new Set();
  }

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this._intentionalLogout = false;
    this.initPromise = this._connect();
    return this.initPromise;
  }

  /**
   * Request a WhatsApp pairing code for the given phone number.
   * The phone should include the country code (e.g. "2348012345678").
   * Returns the formatted XXXX-XXXX code the user types into WhatsApp.
   */
  async requestPairingCode(phone: string): Promise<string> {
    if (this.status.connected) {
      throw new Error("Already connected to WhatsApp. Disconnect first.");
    }

    // Clean: digits only, strip leading +
    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error("Invalid phone number — include country code (e.g. 2348012345678)");
    }

    // Temporarily set intentional flag so the close event on the old socket
    // does NOT trigger an auto-reconnect while we're restarting for pairing.
    this._intentionalLogout = true;

    // Forcefully close the existing socket (e.g. the QR-mode socket started on
    // server boot). Just nulling the reference leaves it running in the
    // background, where its events interfere with the new pairing socket.
    if (this.sock) {
      try { this.sock.end(new Error("Restarting for pairing code")); } catch {}
      this.sock = null;
      // Give the old socket a moment to close before starting fresh
      await new Promise((r) => setTimeout(r, 800));
    }

    // Clear any stale auth files so we start fresh.
    // Leftover partial credentials from a previous QR/pairing attempt can
    // make Baileys think the device is already registered and skip the code.
    this.clearAuthFiles();

    // Reset everything cleanly
    this._intentionalLogout = false;
    this.initPromise = null;
    this._pairingCode = null;
    this._pairingError = null;
    this.qr = null;

    // Start fresh connection; pairing code will be requested inside _connect()
    this.initPromise = this._connect(cleanPhone);

    // Wait up to 30 seconds for the code to arrive (or an error to surface)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this._pairingCode) return this._pairingCode;
      if (this._pairingError) throw new Error(this._pairingError);
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
      "Timed out waiting for pairing code. Make sure the phone number is correct and registered on WhatsApp."
    );
  }

  private async _connect(pairingPhone?: string): Promise<void> {
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

      // ── Pairing code mode: request code right after socket creation ───────
      // Must be called before QR fires so WhatsApp uses pairing code flow.
      if (pairingPhone) {
        try {
          logger.info({ phone: pairingPhone }, "Requesting pairing code from WhatsApp…");
          const code = await sock.requestPairingCode(pairingPhone);
          // Format as XXXX-XXXX for readability
          this._pairingCode = code.length === 8
            ? `${code.slice(0, 4)}-${code.slice(4)}`
            : code;
          this._pairingError = null;
          this.status = { ...this.status, status: "pairing_code_ready" };
          logger.info({ pairingCode: this._pairingCode }, "Pairing code generated successfully");
        } catch (pairErr) {
          const msg = pairErr instanceof Error ? pairErr.message : String(pairErr);
          logger.error({ err: pairErr, phone: pairingPhone }, "Failed to request pairing code");
          this._pairingError = `WhatsApp rejected the pairing code request: ${msg}`;
          // Don't fall through to QR — surface the error to the caller
          return;
        }
      }

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
          this._pairingCode = null; // Pairing complete — clear the code
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
          const errorMessage = boom?.message ?? "";

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
            { statusCode, intentionalLogout: this._intentionalLogout, errorMessage },
            "Connection closed"
          );

          if (this._intentionalLogout) {
            logger.info("Intentional logout — not reconnecting");
            return;
          }

          // ── QR timed out (nobody scanned) — stop the loop ───────────────
          // Baileys throws statusCode 408 with message "QR refs attempts ended"
          // when the QR is never scanned. We must NOT auto-reconnect here or we
          // get an infinite QR generation loop. Wait for the user to manually
          // request a new QR or pairing code.
          if (statusCode === DisconnectReason.timedOut && errorMessage.includes("QR refs")) {
            logger.info("QR code timed out (not scanned) — waiting for user to reconnect manually");
            this.initPromise = null;
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

          if (statusCode === DisconnectReason.badSession) {
            // Corrupted session files — wipe them and start fresh with QR
            logger.warn("Bad session — clearing auth and resetting");
            this.clearAuthFiles();
            this.initPromise = null;
            return;
          }

          // connectionReplaced — another web session opened. Wait briefly then
          // reconnect so this server regains control of the session.
          if (statusCode === DisconnectReason.connectionReplaced) {
            logger.warn("Connection replaced — will reconnect in 5s to resume control");
            setTimeout(() => {
              this.initPromise = this._connect();
            }, 5_000);
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

      // ── Track participants who leave or get removed ───────────────────────
      sock.ev.on("group-participants.update", ({ id, participants, action }) => {
        if (action === "remove" || action === "leave") {
          if (!this._leftParticipants.has(id)) {
            this._leftParticipants.set(id, new Set());
          }
          const leftSet = this._leftParticipants.get(id)!;
          for (const jid of participants) {
            leftSet.add(jid);
          }
          logger.info(
            { groupId: id, action, count: participants.length },
            "Tracked participants who left/were removed — will not be re-added"
          );
        }
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
   */
  private async _initialGroupSync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    const cached = Array.from(this._groupCache.values());

    if (cached.length === 0) {
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
    this._pairingCode = null;
    this._pairingError = null;
    this._connectedSince = null;
    this._reconnectAttempt = 0;
    this._groupCache.clear();
    this._leftParticipants.clear();
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
