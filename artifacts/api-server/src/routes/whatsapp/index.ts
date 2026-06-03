import { Router, type IRouter } from "express";
import { whatsappService } from "../../lib/whatsapp";
import { db, groupsTable } from "@workspace/db";

const router: IRouter = Router();

// Public — UI always needs connection state (auth is handled at router level,
// this route is exempted in routes/index.ts)
router.get("/whatsapp/status", async (req, res): Promise<void> => {
  const status = whatsappService.getStatus();
  res.json(status);
});

// Protected — only the owner can see the QR code
router.get("/whatsapp/qr", async (req, res): Promise<void> => {
  const status = whatsappService.getStatus();
  if (status.connected) {
    res.status(409).json({ error: "Already connected. Disconnect first to generate a new QR code." });
    return;
  }
  const qr = whatsappService.getQR();
  res.json({ qr, status: status.status });
});

// Protected — only the owner can disconnect
router.post("/whatsapp/logout", async (req, res): Promise<void> => {
  await whatsappService.logout();
  res.json({ success: true, message: "Logged out successfully" });
});

// Protected — triggers live WhatsApp call
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
        set: { name: g.subject, memberCount: g.participants?.length ?? null },
      });
  }

  res.json({ success: true, message: `Synced ${groups.length} groups` });
});

export default router;
