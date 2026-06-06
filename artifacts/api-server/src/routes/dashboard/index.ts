import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  contactsTable,
  groupsTable,
  campaignsTable,
  messageLogsTable,
  groupLogsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  // SQLite stores dates as ISO text — compare as string (ISO sorts correctly)
  const todayIso = new Date();
  todayIso.setHours(0, 0, 0, 0);
  const todayStr = todayIso.toISOString();

  // Run all 6 stat queries in parallel instead of sequentially
  const [
    [{ totalContacts }],
    [{ totalGroups }],
    [{ messagesSentToday }],
    [{ activeCampaigns }],
    [{ totalSent }],
    [{ totalFailed }],
  ] = await Promise.all([
    db.select({ totalContacts: sql<number>`count(*)` }).from(contactsTable),
    db.select({ totalGroups: sql<number>`count(*)` }).from(groupsTable),
    db
      .select({ messagesSentToday: sql<number>`count(*)` })
      .from(messageLogsTable)
      .where(
        sql`${messageLogsTable.status} = 'sent' AND ${messageLogsTable.sentAt} >= ${todayStr}`,
      ),
    db
      .select({ activeCampaigns: sql<number>`count(*)` })
      .from(campaignsTable)
      .where(eq(campaignsTable.status, "running")),
    db
      .select({ totalSent: sql<number>`count(*)` })
      .from(messageLogsTable)
      .where(eq(messageLogsTable.status, "sent")),
    db
      .select({ totalFailed: sql<number>`count(*)` })
      .from(messageLogsTable)
      .where(eq(messageLogsTable.status, "failed")),
  ]);

  const totalSentNum = Number(totalSent ?? 0);
  const totalFailedNum = Number(totalFailed ?? 0);
  const totalAttempted = totalSentNum + totalFailedNum;
  const successRate =
    totalAttempted > 0 ? Math.round((totalSentNum / totalAttempted) * 100) : 0;

  res.json({
    totalContacts: Number(totalContacts ?? 0),
    totalGroups: Number(totalGroups ?? 0),
    messagesSentToday: Number(messagesSentToday ?? 0),
    activeCampaigns: Number(activeCampaigns ?? 0),
    successRate,
    totalMessagesSent: totalSentNum,
    totalMessagesFailed: totalFailedNum,
  });
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const messageLogs = await db
    .select({
      id: messageLogsTable.id,
      status: messageLogsTable.status,
      createdAt: messageLogsTable.createdAt,
      contactName: contactsTable.name,
      contactPhone: contactsTable.phone,
    })
    .from(messageLogsTable)
    .leftJoin(contactsTable, eq(messageLogsTable.contactId, contactsTable.id))
    .orderBy(sql`${messageLogsTable.createdAt} desc`)
    .limit(10);

  const groupLogs = await db
    .select({
      id: groupLogsTable.id,
      status: groupLogsTable.status,
      createdAt: groupLogsTable.createdAt,
      contactName: contactsTable.name,
      groupName: groupsTable.name,
    })
    .from(groupLogsTable)
    .leftJoin(contactsTable, eq(groupLogsTable.contactId, contactsTable.id))
    .leftJoin(groupsTable, eq(groupLogsTable.groupId, groupsTable.id))
    .orderBy(sql`${groupLogsTable.createdAt} desc`)
    .limit(10);

  const activity = [
    ...messageLogs.map((l) => ({
      id: `msg-${l.id}`,
      type: "message",
      message: `Message ${l.status} for ${l.contactName ?? l.contactPhone ?? "unknown contact"}`,
      timestamp: l.createdAt,
      status: l.status,
    })),
    ...groupLogs.map((l) => ({
      id: `grp-${l.id}`,
      type: "group",
      message: `${l.contactName ?? "Unknown contact"} ${l.status} to ${l.groupName ?? "unknown group"}`,
      timestamp: l.createdAt,
      status: l.status,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  res.json(activity);
});

export default router;
