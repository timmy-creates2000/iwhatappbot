import { Router, type IRouter } from "express";
import { eq, gte, sql } from "drizzle-orm";
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
  const [{ totalContacts }] = await db
    .select({ totalContacts: sql<number>`count(*)` })
    .from(contactsTable);

  const [{ totalGroups }] = await db
    .select({ totalGroups: sql<number>`count(*)` })
    .from(groupsTable);

  // SQLite stores dates as ISO text — compare as string (ISO sorts correctly)
  const todayIso = new Date();
  todayIso.setHours(0, 0, 0, 0);
  const todayStr = todayIso.toISOString();

  const [{ messagesSentToday }] = await db
    .select({ messagesSentToday: sql<number>`count(*)` })
    .from(messageLogsTable)
    .where(
      sql`${messageLogsTable.status} = 'sent' AND ${messageLogsTable.sentAt} >= ${todayStr}`,
    );

  const [{ activeCampaigns }] = await db
    .select({ activeCampaigns: sql<number>`count(*)` })
    .from(campaignsTable)
    .where(eq(campaignsTable.status, "running"));

  const [{ totalSent }] = await db
    .select({ totalSent: sql<number>`count(*)` })
    .from(messageLogsTable)
    .where(eq(messageLogsTable.status, "sent"));

  const [{ totalFailed }] = await db
    .select({ totalFailed: sql<number>`count(*)` })
    .from(messageLogsTable)
    .where(eq(messageLogsTable.status, "failed"));

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
    .select()
    .from(messageLogsTable)
    .orderBy(sql`${messageLogsTable.createdAt} desc`)
    .limit(10);

  const groupLogs = await db
    .select()
    .from(groupLogsTable)
    .orderBy(sql`${groupLogsTable.createdAt} desc`)
    .limit(10);

  const activity = [
    ...messageLogs.map((l) => ({
      id: `msg-${l.id}`,
      type: "message",
      message: `Message ${l.status} for contact #${l.contactId ?? "unknown"}`,
      timestamp: l.createdAt,
      status: l.status,
    })),
    ...groupLogs.map((l) => ({
      id: `grp-${l.id}`,
      type: "group",
      message: `Contact #${l.contactId ?? "unknown"} ${l.status} to group #${l.groupId ?? "unknown"}`,
      timestamp: l.createdAt,
      status: l.status,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  res.json(activity);
});

export default router;
