import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { whatsappService } from "../../lib/whatsapp";
import { db, groupsTable, groupLogsTable } from "@workspace/db";

const router: IRouter = Router();

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

// Protected — triggers live WhatsApp call, syncs ALL groups the number participates in
router.post("/whatsapp/groups/sync", async (req, res): Promise<void> => {
  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ success: false, message: "Not connected to WhatsApp. Scan QR first." });
    return;
  }

  const waGroups = await whatsappService.fetchGroups();
  if (waGroups === null) {
    res.status(500).json({ success: false, message: "Failed to fetch groups from WhatsApp. Try again." });
    return;
  }

  // Upsert all WhatsApp groups — insert new, update changed name/memberCount
  let added = 0;
  let updated = 0;
  if (waGroups.length > 0) {
    const existing = await db.select().from(groupsTable);
    const existingByGroupId = new Map(existing.map((g) => [g.groupId, g]));

    const toInsert = waGroups.filter((g) => !existingByGroupId.has(g.id));
    const toUpdate = waGroups.filter((g) => {
      const db = existingByGroupId.get(g.id);
      return db && (db.name !== g.subject || db.memberCount !== (g.participants?.length ?? null));
    });

    if (toInsert.length > 0) {
      await db.insert(groupsTable).values(
        toInsert.map((g) => ({
          groupId: g.id,
          name: g.subject,
          memberCount: g.participants?.length ?? null,
        }))
      );
      added = toInsert.length;
    }

    // Update changed groups one-by-one (small sets in practice)
    for (const g of toUpdate) {
      const row = existingByGroupId.get(g.id)!;
      await db.update(groupsTable)
        .set({ name: g.subject, memberCount: g.participants?.length ?? null })
        .where(eq(groupsTable.id, row.id));
    }
    updated = toUpdate.length;

    // Remove groups that have left WhatsApp (only WA-synced rows, not local- ones)
    const waGroupIds = new Set(waGroups.map((g) => g.id));
    const stale = existing.filter((g) => !g.groupId.startsWith("local-") && !waGroupIds.has(g.groupId));
    if (stale.length > 0) {
      const staleIds = stale.map((g) => g.id);
      await db.delete(groupLogsTable).where(inArray(groupLogsTable.groupId, staleIds));
      await db.delete(groupsTable).where(inArray(groupsTable.id, staleIds));
    }
  }

  const total = waGroups.length;
  res.json({
    success: true,
    message: total > 0
      ? `Sync complete — ${added} added, ${updated} updated, ${total} total`
      : "No groups found. Make sure your WhatsApp number is in at least one group.",
  });
});

export default router;
