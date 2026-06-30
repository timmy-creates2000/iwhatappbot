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

/** Extract a phone number from a JID (strip @s.whatsapp.net) */
function jidToPhone(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

// ── Background add-contacts job store ─────────────────────────────────────────
// Keyed by group DB id. One job per group at a time.

interface AddJob {
  groupDbId: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: "running" | "done" | "error";
  error?: string;
  startedAt: Date;
  finishedAt?: Date;
}

const addJobs = new Map<number, AddJob>();

/**
 * Wait up to `timeoutMs` for WhatsApp to reconnect.
 * Returns true if connected before timeout.
 */
async function waitForReconnect(timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (whatsappService.getStatus().connected) return true;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

// WhatsApp status codes from groupParticipantsUpdate:
//   "200" = success
//   "403" = forbidden (not admin, or privacy settings)
//   "408" = number not on WhatsApp
//   "409" = already in group (treat as success)
const SUCCESS_CODES = new Set(["200", "409"]);

/**
 * Background processor — runs after the HTTP response is sent.
 * Adds contacts one at a time with a configurable delay between each.
 * Auto-waits if WhatsApp disconnects mid-run.
 *
 * Skip logic (two cases):
 *  1. Contact is already in the group → mark "skipped", count as success, no delay.
 *  2. Contact previously left/was removed from the group → mark "left_before", count as failed, no delay.
 */
async function runAddJob(
  job: AddJob,
  group: { id: number; groupId: string },
  contacts: Array<{ id: number; phone: string; name: string }>,
  logIdByContactId: Map<number, number>,
  delayMs: number
): Promise<void> {
  // ── Pre-flight: fetch current participants to detect already-present contacts ─
  const currentParticipants = await whatsappService.getGroupParticipants(group.groupId) ?? [];
  // Build a Set of raw digit strings (no @ suffix) for fast phone lookup
  const currentPhoneSet = new Set(
    currentParticipants.map((p) => p.id.split("@")[0] ?? "")
  );

  // ── Get participants who previously left this group ───────────────────────
  const previouslyLeft = whatsappService.getPreviouslyLeft(group.groupId);

  const succeeded: number[] = [];
  const failed: number[] = [];
  const skipped: number[] = [];      // already in group
  const leftBefore: number[] = [];   // previously left — do not re-add

  for (const contact of contacts) {
    if (job.status !== "running") break;

    // Normalize phone to digits-only (strip leading +) for comparison
    const normalizedPhone = contact.phone.startsWith("+")
      ? contact.phone.slice(1)
      : contact.phone;
    const contactJid = toJid(contact.phone);

    // ── Skip: already in the group ────────────────────────────────────────
    if (currentPhoneSet.has(normalizedPhone)) {
      logger.info(
        { contactId: contact.id, phone: contact.phone },
        "Contact already in group — skipping"
      );
      const lid = logIdByContactId.get(contact.id);
      if (lid !== undefined) skipped.push(lid);
      job.processed++;
      job.succeeded++; // Already there = effectively a success
      continue;
    }

    // ── Skip: previously left/removed — respect their choice ─────────────
    if (previouslyLeft.has(contactJid)) {
      logger.info(
        { contactId: contact.id, phone: contact.phone },
        "Contact previously left group — skipping re-add"
      );
      const lid = logIdByContactId.get(contact.id);
      if (lid !== undefined) leftBefore.push(lid);
      job.processed++;
      job.failed++;
      continue;
    }

    // If disconnected, wait for reconnect (up to 2 minutes)
    if (!whatsappService.getStatus().connected) {
      logger.warn({ groupId: group.groupId }, "WA disconnected mid-run — waiting for reconnect");
      const reconnected = await waitForReconnect(120_000);
      if (!reconnected) {
        job.status = "error";
        job.error = "WhatsApp disconnected and did not reconnect within 2 minutes";
        job.finishedAt = new Date();
        // Mark remaining as failed
        const remaining = contacts.slice(contacts.indexOf(contact));
        const remainingIds = remaining
          .map((c) => logIdByContactId.get(c.id))
          .filter((id): id is number => id !== undefined);
        if (remainingIds.length > 0) {
          await db.update(groupLogsTable).set({ status: "failed" }).where(inArray(groupLogsTable.id, remainingIds));
        }
        break;
      }
      logger.info("WA reconnected — resuming add-contacts job");
    }

    try {
      const statusCode = await whatsappService.addToGroup(group.groupId, contactJid);
      const lid = logIdByContactId.get(contact.id);
      if (lid !== undefined) {
        if (SUCCESS_CODES.has(statusCode)) {
          succeeded.push(lid);
          job.succeeded++;
          // Track as now-in-group so subsequent contacts in the same batch
          // don't attempt to add the same number twice
          currentPhoneSet.add(normalizedPhone);
        } else {
          logger.warn({ statusCode, contactId: contact.id }, "WA rejected participant");
          failed.push(lid);
          job.failed++;
        }
      }
    } catch (err) {
      logger.error({ err, contactId: contact.id }, "Failed to add contact to group");
      const lid = logIdByContactId.get(contact.id);
      if (lid !== undefined) failed.push(lid);
      job.failed++;
    }

    job.processed++;

    // Flush DB updates in batches of 10 for efficiency
    if (succeeded.length >= 10) {
      await db.update(groupLogsTable).set({ status: "added" }).where(inArray(groupLogsTable.id, [...succeeded]));
      succeeded.length = 0;
    }
    if (failed.length >= 10) {
      await db.update(groupLogsTable).set({ status: "failed" }).where(inArray(groupLogsTable.id, [...failed]));
      failed.length = 0;
    }

    // Delay between contacts (skip after the last one)
    if (contacts.indexOf(contact) < contacts.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Final flush
  if (succeeded.length > 0) {
    await db.update(groupLogsTable).set({ status: "added" }).where(inArray(groupLogsTable.id, succeeded));
  }
  if (failed.length > 0) {
    await db.update(groupLogsTable).set({ status: "failed" }).where(inArray(groupLogsTable.id, failed));
  }
  if (skipped.length > 0) {
    await db.update(groupLogsTable).set({ status: "skipped" }).where(inArray(groupLogsTable.id, skipped));
  }
  if (leftBefore.length > 0) {
    await db.update(groupLogsTable).set({ status: "left_before" }).where(inArray(groupLogsTable.id, leftBefore));
  }

  if (job.status === "running") {
    job.status = "done";
    job.finishedAt = new Date();
    logger.info(
      {
        groupId: group.groupId,
        succeeded: job.succeeded,
        failed: job.failed,
        skipped: skipped.length,
        leftBefore: leftBefore.length,
      },
      "Add-contacts job complete"
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

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
    const groups = await db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, params.data.id));

    if (!groups || groups.length === 0) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const group = groups[0];

    if (group.groupId && !group.groupId.startsWith("local-")) {
      try {
        const waStatus = whatsappService.getStatus();
        if (waStatus.connected) {
          await whatsappService.deleteGroup(group.groupId);
          logger.info({ groupId: group.groupId }, "Successfully left WhatsApp group");
        }
      } catch (err) {
        logger.warn({ err, groupId: group.groupId }, "Failed to delete group from WhatsApp, removing from DB only");
      }
    }

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

/** Start background add-contacts job — returns immediately */
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

  // If a job is already running for this group, reject
  const existing = addJobs.get(params.data.id);
  if (existing?.status === "running") {
    res.status(409).json({ error: "An add-contacts job is already running for this group" });
    return;
  }

  const uniqueIds = [...new Set(parsed.data.contactIds)];
  if (uniqueIds.length === 0) {
    res.status(400).json({ error: "No contacts selected" });
    return;
  }

  const contacts = await db
    .select()
    .from(contactsTable)
    .where(inArray(contactsTable.id, uniqueIds));

  if (contacts.length === 0) {
    res.status(404).json({ error: "None of the selected contacts were found" });
    return;
  }

  // Insert all log entries as pending up front
  const logEntries = await db
    .insert(groupLogsTable)
    .values(contacts.map((c) => ({ contactId: c.id, groupId: group.id, status: "pending" })))
    .returning();

  const logIdByContactId = new Map(
    logEntries
      .filter((l): l is typeof l & { contactId: number } => l.contactId !== null)
      .map((l) => [l.contactId, l.id])
  );

  const delayMs = Math.max(500, parsed.data.delayMs ?? 3_000);

  const job: AddJob = {
    groupDbId: params.data.id,
    total: contacts.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    status: "running",
    startedAt: new Date(),
  };
  addJobs.set(params.data.id, job);

  // Fire and forget — don't await
  runAddJob(job, group, contacts, logIdByContactId, delayMs).catch((err: unknown) => {
    logger.error({ err }, "Add-contacts job crashed");
    job.status = "error";
    job.error = err instanceof Error ? err.message : "Unknown error";
    job.finishedAt = new Date();
  });

  res.status(202).json({
    success: true,
    message: `Adding ${contacts.length} contact${contacts.length !== 1 ? "s" : ""} in the background`,
  });
});

/** Poll status of the add-contacts background job for this group */
router.get("/groups/:id/add-contacts/status", (req, res): void => {
  const rawId = Number(req.params["id"]);
  if (!Number.isInteger(rawId) || rawId <= 0) {
    res.status(400).json({ error: "Invalid group id" });
    return;
  }

  const job = addJobs.get(rawId);
  if (!job) {
    res.json({ status: "idle" });
    return;
  }

  res.json({
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    error: job.error ?? null,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
});

/** Fetch participants of a synced WhatsApp group */
router.get("/groups/:id/participants", async (req, res): Promise<void> => {
  const rawId = Number(req.params["id"]);
  if (!Number.isInteger(rawId) || rawId <= 0) {
    res.status(400).json({ error: "Invalid group id" });
    return;
  }

  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, rawId));

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  if (!group.groupId || group.groupId.startsWith("local-")) {
    res.status(400).json({ error: "This group is not synced from WhatsApp" });
    return;
  }

  if (!whatsappService.getStatus().connected) {
    res.status(400).json({ error: "WhatsApp is not connected" });
    return;
  }

  try {
    const participants = await whatsappService.getGroupParticipants(group.groupId);
    if (!participants) {
      res.status(500).json({ error: "Failed to fetch participants" });
      return;
    }

    // Build phone → participant map
    const phones = participants.map((p) => jidToPhone(p.id));

    // Look up any matching contacts in the local DB so we can fill in names
    const matchedContacts = phones.length > 0
      ? await db.select({ name: contactsTable.name, phone: contactsTable.phone })
          .from(contactsTable)
          .where(inArray(contactsTable.phone, phones))
      : [];

    const phoneToName = new Map(matchedContacts.map((c) => [c.phone, c.name]));

    const result = participants.map((p) => {
      const phone = jidToPhone(p.id);
      // Priority: DB contact name → phone number as fallback label
      const name = phoneToName.get(phone) ?? `+${phone}`;
      return {
        jid: p.id,
        phone,
        name,
        isAdmin: p.admin === "admin" || p.admin === "superadmin",
      };
    });

    res.json(result);
  } catch (err) {
    logger.error({ err, groupId: group.groupId }, "Failed to fetch participants");
    res.status(500).json({ error: "Failed to fetch participants from WhatsApp" });
  }
});

export default router;
