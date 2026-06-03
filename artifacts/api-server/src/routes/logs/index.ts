import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  messageLogsTable,
  groupLogsTable,
  contactsTable,
  groupsTable,
  campaignsTable,
} from "@workspace/db";
import { ListMessageLogsQueryParams, ListGroupLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/logs/messages", async (req, res): Promise<void> => {
  const parsed = ListMessageLogsQueryParams.safeParse(req.query);
  const status = parsed.success ? parsed.data.status : undefined;

  // Filter in SQL rather than fetching the whole table into JS
  const query = db
    .select({
      id: messageLogsTable.id,
      contactId: messageLogsTable.contactId,
      campaignId: messageLogsTable.campaignId,
      message: messageLogsTable.message,
      status: messageLogsTable.status,
      sentAt: messageLogsTable.sentAt,
      createdAt: messageLogsTable.createdAt,
      contactName: contactsTable.name,
      contactPhone: contactsTable.phone,
      campaignName: campaignsTable.name,
    })
    .from(messageLogsTable)
    .leftJoin(contactsTable, eq(messageLogsTable.contactId, contactsTable.id))
    .leftJoin(campaignsTable, eq(messageLogsTable.campaignId, campaignsTable.id))
    .orderBy(messageLogsTable.createdAt)
    .$dynamic();

  const rows = status
    ? await query.where(eq(messageLogsTable.status, status))
    : await query;

  res.json(rows);
});

router.get("/logs/groups", async (req, res): Promise<void> => {
  const parsed = ListGroupLogsQueryParams.safeParse(req.query);
  const status = parsed.success ? parsed.data.status : undefined;

  const query = db
    .select({
      id: groupLogsTable.id,
      contactId: groupLogsTable.contactId,
      groupId: groupLogsTable.groupId,
      status: groupLogsTable.status,
      createdAt: groupLogsTable.createdAt,
      contactName: contactsTable.name,
      contactPhone: contactsTable.phone,
      groupName: groupsTable.name,
    })
    .from(groupLogsTable)
    .leftJoin(contactsTable, eq(groupLogsTable.contactId, contactsTable.id))
    .leftJoin(groupsTable, eq(groupLogsTable.groupId, groupsTable.id))
    .orderBy(groupLogsTable.createdAt)
    .$dynamic();

  const rows = status
    ? await query.where(eq(groupLogsTable.status, status))
    : await query;

  res.json(rows);
});

export default router;
