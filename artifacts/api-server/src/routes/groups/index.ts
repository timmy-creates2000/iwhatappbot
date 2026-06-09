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

  try {
    // Get the group from DB to find groupId
    const groups = await db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, params.data.id));

    if (!groups || groups.length === 0) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const group = groups[0];

    // If group was synced from WhatsApp (has a proper groupId), try to leave it
    if (group.groupId && !group.groupId.startsWith("local-")) {
      try {
        const waStatus = whatsappService.getStatus();
        if (waStatus.connected) {
          await whatsappService.deleteGroup(group.groupId);
          logger.info({ groupId: group.groupId }, "Successfully left WhatsApp group");
        }
      } catch (err) {
        logger.warn({ err, groupId: group.groupId }, "Failed to delete group from WhatsApp, removing from DB only");
        // Continue with DB deletion even if WhatsApp delete fails
      }
    }

    // Delete from database
    const [deletedGroup] = await db
      .delete(groupsTable)
      .where(eq(groupsTable.id, params.data.id))
      .returning();

    if (!deletedGroup) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    res.json({ success: true, message: "Group deleted successfully", group: deletedGroup });
  } catch (err) {
    logger.error({ err, groupId: params.data.id }, "Error deleting group");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete group" });
  }
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

  // Batch-insert all pending log entries up front
  const logEntries = await db
    .insert(groupLogsTable)
    .values(contacts.map((c) => ({ contactId: c.id, groupId: group.id, status: "pending" })))
    .returning();

  // Map contactId → logEntry id for fast lookup
  const logById = new Map(logEntries.map((l) => [l.contactId, l.id]));

  // Run WhatsApp add calls in parallel (max 5 concurrent to avoid rate-limits)
  const CONCURRENCY = 5;
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const batch = contacts.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (contact) => {
        try {
          await whatsappService.addToGroup(group.groupId, toJid(contact.phone));
          const lid = logById.get(contact.id);
          if (lid !== undefined) succeeded.push(lid);
        } catch (err) {
          logger.error({ err, contactId: contact.id, groupId: group.id }, "Failed to add contact to group");
          const lid = logById.get(contact.id);
          if (lid !== undefined) failed.push(lid);
        }
      })
    );
  }

  // Batch-update log statuses
  if (succeeded.length > 0) {
    await db.update(groupLogsTable).set({ status: "added" }).where(inArray(groupLogsTable.id, succeeded));
  }
  if (failed.length > 0) {
    await db.update(groupLogsTable).set({ status: "failed" }).where(inArray(groupLogsTable.id, failed));
  }

  res.json({ success: true, message: `Processing ${contacts.length} contacts` });
});

export default router;
