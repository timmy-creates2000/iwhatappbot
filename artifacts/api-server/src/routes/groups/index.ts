import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, groupsTable, groupLogsTable, contactsTable } from "@workspace/db";
import {
  AddContactsToGroupParams,
  AddContactsToGroupBody,
  CreateGroupBody,
  UpdateGroupParams,
  UpdateGroupBody,
  DeleteGroupParams,
} from "@workspace/api-zod";
import { whatsappService } from "../../lib/whatsapp";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

/** Normalize phone to JID: strip leading +, append @s.whatsapp.net */
function toJid(phone: string): string {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return `${digits}@s.whatsapp.net`;
}

router.get("/groups", async (req, res): Promise<void> => {
  const groups = await db.select().from(groupsTable).orderBy(groupsTable.createdAt);
  res.json(groups);
});

router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [group] = await db
    .insert(groupsTable)
    .values({
      name: parsed.data.name,
      groupId: parsed.data.groupId ?? `local-${Date.now()}`,
      memberCount: parsed.data.memberCount ?? null,
    })
    .returning();

  res.status(201).json(group);
});

router.put("/groups/:id", async (req, res): Promise<void> => {
  const params = UpdateGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [group] = await db
    .update(groupsTable)
    .set({ name: parsed.data.name, memberCount: parsed.data.memberCount ?? null })
    .where(eq(groupsTable.id, params.data.id))
    .returning();

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  res.json(group);
});

router.delete("/groups/:id", async (req, res): Promise<void> => {
  const params = DeleteGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [group] = await db
    .delete(groupsTable)
    .where(eq(groupsTable.id, params.data.id))
    .returning();

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  res.json({ success: true, message: "Group deleted" });
});

router.post("/groups/:id/add-contacts", async (req, res): Promise<void> => {
  const params = AddContactsToGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddContactsToGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ error: "WhatsApp is not connected" });
    return;
  }

  // Deduplicate incoming contactIds
  const uniqueIds = [...new Set(parsed.data.contactIds)];

  const contacts = await db
    .select()
    .from(contactsTable)
    .where(inArray(contactsTable.id, uniqueIds));

  for (const contact of contacts) {
    const [logEntry] = await db
      .insert(groupLogsTable)
      .values({ contactId: contact.id, groupId: group.id, status: "pending" })
      .returning();

    try {
      await whatsappService.addToGroup(group.groupId, toJid(contact.phone));
      await db
        .update(groupLogsTable)
        .set({ status: "added" })
        .where(eq(groupLogsTable.id, logEntry.id));
    } catch (err) {
      logger.error({ err, contactId: contact.id, groupId: group.id }, "Failed to add contact to group");
      await db
        .update(groupLogsTable)
        .set({ status: "failed" })
        .where(eq(groupLogsTable.id, logEntry.id));
    }
  }

  res.json({ success: true, message: `Processing ${contacts.length} contacts` });
});

export default router;
