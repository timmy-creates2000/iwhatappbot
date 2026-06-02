import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
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

async function getCampaignWithCounts(id: number) {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) return null;

  const logs = await db
    .select()
    .from(messageLogsTable)
    .where(eq(messageLogsTable.campaignId, id));

  const sentCount = logs.filter((l) => l.status === "sent").length;
  const failedCount = logs.filter((l) => l.status === "failed").length;

  return {
    ...campaign,
    sentCount,
    failedCount,
    totalCount: logs.length,
  };
}

router.get("/campaigns", async (req, res): Promise<void> => {
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(campaignsTable.createdAt);

  const result = await Promise.all(
    campaigns.map(async (c) => {
      const logs = await db
        .select()
        .from(messageLogsTable)
        .where(eq(messageLogsTable.campaignId, c.id));
      return {
        ...c,
        sentCount: logs.filter((l) => l.status === "sent").length,
        failedCount: logs.filter((l) => l.status === "failed").length,
        totalCount: logs.length,
      };
    })
  );

  res.json(result);
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { contactIds, ...campaignData } = parsed.data;

  const [campaign] = await db
    .insert(campaignsTable)
    .values({ ...campaignData, status: "draft" })
    .returning();

  if (contactIds?.length) {
    await db.insert(campaignContactsTable).values(
      contactIds.map((contactId) => ({ campaignId: campaign.id, contactId }))
    );

    // Create pending message logs
    await db.insert(messageLogsTable).values(
      contactIds.map((contactId) => ({
        campaignId: campaign.id,
        contactId,
        status: "pending",
      }))
    );
  }

  res.status(201).json({ ...campaign, sentCount: 0, failedCount: 0, totalCount: contactIds?.length ?? 0 });
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

  const [campaign] = await db
    .update(campaignsTable)
    .set(parsed.data)
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

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "running", startDate: new Date() })
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  // Process messages asynchronously
  void processCampaignMessages(campaign.id, campaign.messageTemplate);

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

  res.json({ success: true, message: "Campaign paused" });
});

router.post("/campaigns/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "failed" })
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

  res.json(
    logs.map((l) => ({
      ...l,
      campaignName: null,
    }))
  );
});

async function processCampaignMessages(campaignId: number, template: string) {
  try {
    const pendingLogs = await db
      .select()
      .from(messageLogsTable)
      .where(eq(messageLogsTable.campaignId, campaignId));

    const pendingContactIds = pendingLogs
      .filter((l) => l.status === "pending" && l.contactId != null)
      .map((l) => l.contactId as number);

    if (!pendingContactIds.length) return;

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.id, pendingContactIds));

    for (const contact of contacts) {
      // Check if campaign is still running
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId));

      if (!campaign || campaign.status !== "running") break;

      const personalizedMessage = template
        .replace(/\{\{name\}\}/g, contact.name)
        .replace(/\{\{phone\}\}/g, contact.phone);

      const logEntry = pendingLogs.find((l) => l.contactId === contact.id);

      if (whatsappService.getStatus().connected) {
        try {
          const phone = contact.phone.startsWith("+")
            ? contact.phone.slice(1)
            : contact.phone;
          await whatsappService.sendMessage(`${phone}@s.whatsapp.net`, personalizedMessage);

          if (logEntry) {
            await db
              .update(messageLogsTable)
              .set({ status: "sent", message: personalizedMessage, sentAt: new Date() })
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
      } else {
        // Simulate sending if not connected
        if (logEntry) {
          await db
            .update(messageLogsTable)
            .set({ status: "failed", message: personalizedMessage })
            .where(eq(messageLogsTable.id, logEntry.id));
        }
      }

      // Delay between messages to avoid spam
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Mark campaign as completed
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
  }
}

export default router;
