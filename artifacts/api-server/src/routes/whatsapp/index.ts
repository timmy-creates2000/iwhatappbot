import { Router, type IRouter } from "express";
import { whatsappService } from "../../lib/whatsapp";
import { db, groupsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/whatsapp/status", async (req, res): Promise<void> => {
  const status = whatsappService.getStatus();
  res.json(status);
});

router.get("/whatsapp/qr", async (req, res): Promise<void> => {
  const qr = whatsappService.getQR();
  const status = whatsappService.getStatus();
  res.json({ qr, status: status.status });
});

router.post("/whatsapp/logout", async (req, res): Promise<void> => {
  await whatsappService.logout();
  res.json({ success: true, message: "Logged out successfully" });
});

router.post("/whatsapp/groups/sync", async (req, res): Promise<void> => {
  const groups = await whatsappService.fetchGroups();
  if (!groups) {
    res.status(400).json({ success: false, message: "Not connected to WhatsApp" });
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
