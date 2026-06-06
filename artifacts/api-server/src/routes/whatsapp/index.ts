import { Router, type IRouter } from "express";
import { whatsappService } from "../../lib/whatsapp";
import { db, groupsTable, groupLogsTable } from "@workspace/db";

const router: IRouter = Router();

// Protected — only the owner can see the QR code
// Auto-initializes the service if it's stuck in a disconnected state (e.g. after stale auth)
router.get("/whatsapp/qr", async (req, res): Promise<void> => {
  const status = whatsappService.getStatus();
  if (status.connected) {
    res.status(409).json({ error: "Already connected. Disconnect first to generate a new QR code." });
    return;
  }

  // If disconnected with no active connection attempt, kick off initialization
  // so the next poll will have a QR code ready.
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
  res.json({ success: true, message: "Logged out successfully" });
});

// Protected — triggers live WhatsApp call, syncs only groups where connected number is admin
router.post("/whatsapp/groups/sync", async (req, res): Promise<void> => {
  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ success: false, message: "Not connected to WhatsApp" });
    return;
  }

  const groups = await whatsappService.fetchGroups();
  if (!groups) {
    res.status(400).json({ success: false, message: "Failed to fetch groups from WhatsApp" });
    return;
  }

  // Clear existing groups and logs before re-syncing so stale data never lingers
  await db.delete(groupLogsTable);
  await db.delete(groupsTable);

  if (groups.length > 0) {
    await db.insert(groupsTable).values(
      groups.map((g) => ({
        groupId: g.id,
        name: g.subject,
        memberCount: g.participants?.length ?? null,
      }))
    );
  }

  res.json({ success: true, message: `Synced ${groups.length} admin groups` });
});

export default router;
