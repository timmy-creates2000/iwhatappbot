import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { whatsappService } from "../../lib/whatsapp";
import { db, groupsTable, groupLogsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// ── In-memory sync state ──────────────────────────────────────────────────────
interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  completedAt: string;
}

interface SyncState {
  status: "idle" | "syncing";
  lastSync: SyncResult | null;
  error: string | null;
}

const syncState: SyncState = { status: "idle", lastSync: null, error: null };

async function runGroupSync(): Promise<void> {
  // Use the in-memory cache built from groups.upsert events — no 50-group cap.
  // groupFetchAllParticipating() is hard-capped at ~50 by WhatsApp's protocol.
  const waGroups = await whatsappService.fetchAllGroups();

  if (waGroups === null) {
    throw new Error("Not connected to WhatsApp");
  }

  if (waGroups.length === 0) {
    throw new Error(
      "Group cache is empty. Wait a few seconds after connecting for WhatsApp to finish streaming all groups, then try again."
    );
  }

  // Full resync: delete every WA-synced row (not local-* ones), then
  // re-insert the complete cache. This is safe because the cache contains
  // every group WhatsApp streamed via groups.upsert on connect (no cap).
  const existing = await db.select().from(groupsTable);
  const waGroupIds = existing
    .filter((g) => !g.groupId.startsWith("local-"))
    .map((g) => g.id);

  if (waGroupIds.length > 0) {
    await db.delete(groupLogsTable).where(inArray(groupLogsTable.groupId, waGroupIds));
    await db.delete(groupsTable).where(inArray(groupsTable.id, waGroupIds));
  }

  // Re-insert all groups from cache
  await db.insert(groupsTable).values(
    waGroups.map((g) => ({
      groupId: g.id,
      name: g.subject,
      memberCount: g.participants?.length ?? null,
    }))
  );

  logger.info({ total: waGroups.length, removed: waGroupIds.length }, "Group resync complete");

  syncState.lastSync = {
    added: waGroups.length,
    updated: 0,
    removed: waGroupIds.length,
    total: waGroups.length,
    completedAt: new Date().toISOString(),
  };
}

// Request a pairing code for a phone number (alternative to QR scan)
router.post("/whatsapp/pair", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };

  if (!phone || typeof phone !== "string") {
    res.status(400).json({ error: "phone is required (e.g. 2348012345678)" });
    return;
  }

  const status = whatsappService.getStatus();
  if (status.connected) {
    res.status(409).json({ error: "Already connected. Disconnect first." });
    return;
  }

  try {
    const code = await whatsappService.requestPairingCode(phone.trim());
    res.json({ code });
  } catch (err) {
    logger.error({ err }, "Failed to generate pairing code");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate pairing code" });
  }
});

// Protected — only the owner can see the QR code
router.get("/whatsapp/qr", async (req, res): Promise<void> => {
  const status = whatsappService.getStatus();
  if (status.connected) {
    res.status(409).json({ error: "Already connected. Disconnect first to generate a new QR code." });
    return;
  }

  // Auto-initialize so QR is ready on first poll after logout
  if (status.status === "disconnected") {
    whatsappService.initialize().catch(() => {});
  }

  const qr = whatsappService.getQR();
  res.json({ qr, status: whatsappService.getStatus().status });
});

// Protected — refresh QR code (useful when QR expires)
router.post("/whatsapp/qr/refresh", async (req, res): Promise<void> => {
  try {
    const status = whatsappService.getStatus();
    if (status.connected) {
      res.status(409).json({ error: "Already connected. Call /whatsapp/logout first to generate a new QR code." });
      return;
    }

    await whatsappService.refreshQR();

    // Give it a moment to generate new QR
    await new Promise(resolve => setTimeout(resolve, 500));

    const newQr = whatsappService.getQR();
    const newStatus = whatsappService.getStatus();
    res.json({ qr: newQr, status: newStatus.status, message: "New QR code generated. Please scan it quickly as it expires in 60 seconds." });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to refresh QR code" });
  }
});

// Protected — only the owner can disconnect
router.post("/whatsapp/logout", async (req, res): Promise<void> => {
  await whatsappService.logout();
  // Wipe all synced groups and their logs — next session is a clean slate
  await db.delete(groupLogsTable);
  await db.delete(groupsTable);

  // Start fresh connection immediately so QR is ready when user goes to /connect
  setTimeout(() => {
    whatsappService.initialize().catch(() => {});
  }, 500);

  res.json({ success: true, message: "Logged out successfully" });
});

// Protected — kicks off a background sync, returns immediately
router.post("/whatsapp/groups/sync", (req, res): void => {
  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ success: false, message: "Not connected to WhatsApp. Scan QR first." });
    return;
  }

  if (syncState.status === "syncing") {
    res.status(202).json({ success: true, message: "Sync already in progress" });
    return;
  }

  syncState.status = "syncing";
  syncState.error = null;

  // Fire and forget — client polls /sync/status
  runGroupSync()
    .then(() => {
      syncState.status = "idle";
      logger.info({ result: syncState.lastSync }, "Group sync completed");
    })
    .catch((err: unknown) => {
      syncState.status = "idle";
      syncState.error = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Group sync failed");
    });

  res.status(202).json({ success: true, message: "Sync started" });
});

// Returns current sync state — frontend polls this until status === "idle"
router.get("/whatsapp/groups/sync/status", (req, res): void => {
  res.json({
    ...syncState,
    cacheSize: whatsappService.getCacheSize(),
  });
});

export default router;
