import { Router, type IRouter } from "express";
import { eq, like, inArray } from "drizzle-orm";
import { db, contactsTable } from "@workspace/db";
import {
  ListContactsQueryParams,
  CreateContactBody,
  BulkCreateContactsBody,
  GetContactParams,
  UpdateContactParams,
  UpdateContactBody,
  DeleteContactParams,
  BulkDeleteContactsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/contacts", async (req, res): Promise<void> => {
  const parsed = ListContactsQueryParams.safeParse(req.query);
  const search = parsed.success ? parsed.data.search : undefined;

  const contacts = search
    ? await db
        .select()
        .from(contactsTable)
        .where(like(contactsTable.name, `%${search}%`))
        .orderBy(contactsTable.createdAt)
    : await db.select().from(contactsTable).orderBy(contactsTable.createdAt);

  res.json(contacts);
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db.insert(contactsTable).values(parsed.data).returning();
  res.status(201).json(contact);
});

router.post("/contacts/bulk", async (req, res): Promise<void> => {
  const parsed = BulkCreateContactsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const lines = parsed.data.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errors: string[] = [];
  const validRows: { name: string; phone: string }[] = [];

  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) {
      errors.push(`Invalid line: "${line}"`);
      continue;
    }
    const [name, phone] = parts;
    if (!name || !phone) {
      errors.push(`Missing name or phone: "${line}"`);
      continue;
    }
    validRows.push({ name, phone });
  }

  if (!validRows.length) {
    res.json({ imported: 0, skipped: 0, errors });
    return;
  }

  // Batch insert — all rows in a single statement, skip duplicates by phone
  await db
    .insert(contactsTable)
    .values(validRows)
    .onConflictDoNothing({ target: contactsTable.phone });

  res.json({ imported: validRows.length, skipped: errors.length, errors });
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, params.data.id));

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(contact);
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db
    .update(contactsTable)
    .set(parsed.data)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(contact);
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db
    .delete(contactsTable)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/contacts/bulk-delete", async (req, res): Promise<void> => {
  const parsed = BulkDeleteContactsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .delete(contactsTable)
    .where(inArray(contactsTable.id, parsed.data.ids));

  res.json({ success: true, message: `Deleted ${parsed.data.ids.length} contacts` });
});

export default router;
