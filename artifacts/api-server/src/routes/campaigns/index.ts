import { Router, type IRouter } from "express";
import { eq, inArray, sql, and } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignContactsTable,
  messageLogsTable,
  contactsTable,
} from "@workspace/db";
import {
  CreateCampaignBody,
  GetCampaignParams,
  UpdateCampaignParams,
  UpdateCampaignBody,
  DeleteCampaignParams,
  StartCampaignParams,
  PauseCampaignParams,
  CancelCampaignParams,
  GetCampaignLogsParams,
} from "@workspace/api-zod";
import { whatsappService } from "../../lib/whatsapp";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// Track in-progress campaign IDs to prevent double-start
const runningCampaigns = new Set<number>();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize phone to JID format: strip leading +, append @s.whatsapp.net */
function toJid(phone: string): string {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return `${digits}@s.whatsapp.net`;
}

async function getCampaignWithCounts(id: number) {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) return null;

  const [counts] = await db
    .select({
      sentCount: sql<number>`sum(case when ${messageLogsTable.status} = 'sent' then 1 else 0 end)`,
      failedCount: sql<number>`sum(case when ${messageLogsTable.status} = 'failed' then 1 else 0 end)`,
      totalCount: sql<number>`count(*)`,
    })
    .from(messageLogsTable)
    .where(eq(messageLogsTable.campaignId, id));

  return {
    ...campaign,
    sentCount: counts?.sentCount ?? 0,
    failedCount: counts?.failedCount ?? 0,
    totalCount: counts?.totalCount ?? 0,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/campaigns", async (req, res): Promise<void> => {
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(campaignsTable.createdAt);

  // Single aggregated query instead of N+1
  const allCounts = await db
    .select({
      campaignId: messageLogsTable.campaignId,
      sentCount: sql<number>`sum(case when ${messageLogsTable.status} = 'sent' then 1 else 0 end)`,
      failedCount: sql<number>`sum(case when ${messageLogsTable.status} = 'failed' then 1 else 0 end)`,
      totalCount: sql<number>`count(*)`,
    })
    .from(messageLogsTable)
    .groupBy(messageLogsTable.campaignId);

  const countsById = new Map(allCounts.map((c) => [c.campaignId, c]));

  const result = campaigns.map((c) => {
    const counts = countsById.get(c.id);
    return {
      ...c,
      sentCount: counts?.sentCount ?? 0,
      failedCount: counts?.failedCount ?? 0,
      totalCount: counts?.totalCount ?? 0,
    };
  });

  res.json(result);
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { contactIds, delayBetweenMessages, ...campaignData } = parsed.data;

  const [campaign] = await db
    .insert(campaignsTable)
    .values({ 
      ...campaignData, 
      status: "draft",
      delayBetweenMessages: delayBetweenMessages ?? 1000 
    })
    .returning();

  if (contactIds?.length) {
    // Deduplicate contactIds before inserting
    const uniqueIds = [...new Set(contactIds)];

    await db.insert(campaignContactsTable).values(
      uniqueIds.map((contactId) => ({ campaignId: campaign.id, contactId }))
    );

    await db.insert(messageLogsTable).values(
      uniqueIds.map((contactId) => ({
        campaignId: campaign.id,
        contactId,
        status: "pending",
      }))
    );
  }

  res.status(201).json({
    ...campaign,
    sentCount: 0,
    failedCount: 0,
    totalCount: contactIds?.length ?? 0,
  });
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const campaign = await getCampaignWithCounts(params.data.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(campaign);
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Prevent direct status manipulation through PATCH — use dedicated endpoints
  const { status: _status, ...safeUpdate } = parsed.data;

  const [campaign] = await db
    .update(campaignsTable)
    .set(safeUpdate)
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const full = await getCampaignWithCounts(campaign.id);
  res.json(full);
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (runningCampaigns.has(params.data.id)) {
    res.status(409).json({ error: "Cannot delete a running campaign. Pause or cancel it first." });
    return;
  }

  const [campaign] = await db
    .delete(campaignsTable)
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/campaigns/:id/start", async (req, res): Promise<void> => {
  const params = StartCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const campaignId = params.data.id;

  // Prevent double-start
  if (runningCampaigns.has(campaignId)) {
    res.status(409).json({ error: "Campaign is already running" });
    return;
  }

  // Check WhatsApp is connected before starting
  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ error: "WhatsApp is not connected. Connect your device first." });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.status !== "draft" && campaign.status !== "paused") {
    res.status(409).json({ error: `Campaign cannot be started from status "${campaign.status}"` });
    return;
  }

  await db
    .update(campaignsTable)
    .set({ status: "running", startDate: new Date().toISOString() })
    .where(eq(campaignsTable.id, campaignId));

  runningCampaigns.add(campaignId);
  void processCampaignMessages(campaignId, campaign.messageTemplate);

  res.json({ success: true, message: "Campaign started" });
});

router.post("/campaigns/:id/pause", async (req, res): Promise<void> => {
  const params = PauseCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "paused" })
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  // processCampaignMessages polls status and will stop on next iteration
  res.json({ success: true, message: "Campaign paused — current message will finish then stop" });
});

router.post("/campaigns/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  runningCampaigns.delete(params.data.id);

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "cancelled" })
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json({ success: true, message: "Campaign cancelled" });
});

router.get("/campaigns/:id/logs", async (req, res): Promise<void> => {
  const params = GetCampaignLogsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const logs = await db
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
    })
    .from(messageLogsTable)
    .leftJoin(contactsTable, eq(messageLogsTable.contactId, contactsTable.id))
    .where(eq(messageLogsTable.campaignId, params.data.id));

  res.json(logs.map((l) => ({ ...l, campaignName: null })));
});

// ── Background message processor ─────────────────────────────────────────────

async function processCampaignMessages(campaignId: number, template: string) {
  try {
    // Get campaign with delay configuration
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));

    if (!campaign) {
      logger.error({ campaignId }, "Campaign not found");
      return;
    }

    const delayBetweenMessages = campaign.delayBetweenMessages ?? 1000;

    const pendingLogs = await db
      .select()
      .from(messageLogsTable)
      .where(
        and(
          eq(messageLogsTable.campaignId, campaignId),
          eq(messageLogsTable.status, "pending")
        )
      );

    const pendingContactIds = pendingLogs
      .filter((l) => l.contactId != null)
      .map((l) => l.contactId as number);

    if (!pendingContactIds.length) {
      await db
        .update(campaignsTable)
        .set({ status: "completed" })
        .where(eq(campaignsTable.id, campaignId));
      runningCampaigns.delete(campaignId);
      return;
    }

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.id, pendingContactIds));

    for (const contact of contacts) {
      // Re-check status on every iteration — supports pause and cancel
      const [campaignCheck] = await db
        .select({ status: campaignsTable.status })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId));

      if (!campaignCheck || (campaignCheck.status !== "running")) {
        logger.info({ campaignId, status: campaignCheck?.status }, "Campaign stopped");
        runningCampaigns.delete(campaignId);
        return;
      }

      const personalizedMessage = template
        .replace(/\{\{name\}\}/g, contact.name)
        .replace(/\{\{phone\}\}/g, contact.phone);

      const logEntry = pendingLogs.find((l) => l.contactId === contact.id);

      try {
        await whatsappService.sendMessage(toJid(contact.phone), personalizedMessage);

        if (logEntry) {
          await db
            .update(messageLogsTable)
            .set({ status: "sent", message: personalizedMessage, sentAt: new Date().toISOString() })
            .where(eq(messageLogsTable.id, logEntry.id));
        }
      } catch (err) {
        logger.error({ err, contactId: contact.id }, "Failed to send message");
        if (logEntry) {
          await db
            .update(messageLogsTable)
            .set({ status: "failed", message: personalizedMessage })
            .where(eq(messageLogsTable.id, logEntry.id));
        }
      }

      // Configurable delay between messages to avoid spam detection
      // Add random jitter (±20%) to make traffic look more organic
      const jitter = delayBetweenMessages * 0.2 * (Math.random() - 0.5);
      const actualDelay = Math.max(100, delayBetweenMessages + jitter);
      await new Promise<void>((r) => setTimeout(r, actualDelay));
    }

    await db
      .update(campaignsTable)
      .set({ status: "completed" })
      .where(eq(campaignsTable.id, campaignId));
  } catch (err) {
    logger.error({ err, campaignId }, "Campaign processing error");
    await db
      .update(campaignsTable)
      .set({ status: "failed" })
      .where(eq(campaignsTable.id, campaignId));
  } finally {
    runningCampaigns.delete(campaignId);
  }
}

export default router;
