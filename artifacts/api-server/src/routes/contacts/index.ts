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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse one CSV line respecting double-quoted fields and tab separators. */
function parseFields(line: string): string[] {
  // Tab-separated: split on tabs, strip optional surrounding quotes
  if (line.includes("\t")) {
    return line.split("\t").map((f) => f.trim().replace(/^"|"$/g, ""));
  }

  // Comma-separated with RFC 4180 quote support
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Escaped quote inside a quoted field ("" → ")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const HEADER_KEYWORDS = ["name", "phone", "mobile", "contact", "number", "tel", "email"];

function isHeaderRow(fields: string[]): boolean {
  if (!fields.length) return false;
  return fields.every((f) =>
    HEADER_KEYWORDS.some((k) => f.toLowerCase().includes(k))
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

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

  // Strip UTF-8 BOM if present (Excel often adds this)
  const rawText = parsed.data.text.replace(/^\uFEFF/, "");

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    res.json({ imported: 0, skipped: 0, errors: ["File is empty"] });
    return;
  }

  // Detect and skip header row
  const firstFields = parseFields(lines[0]);
  const dataLines = isHeaderRow(firstFields) ? lines.slice(1) : lines;

  const errors: string[] = [];
  const validRows: { name: string; phone: string }[] = [];

  for (const line of dataLines) {
    const parts = parseFields(line);

    // Phone-only line (e.g. from a .txt export): use phone as name
    if (parts.length === 1) {
      const val = parts[0].replace(/^"|"$/g, "");
      if (/^\+?[\d\s\-().]{6,}$/.test(val)) {
        validRows.push({ name: val, phone: val });
        continue;
      }
      errors.push(`Cannot parse line: "${line}"`);
      continue;
    }

    const [name, phone] = [parts[0].replace(/^"|"$/g, ""), parts[1].replace(/^"|"$/g, "")];
    if (!name || !phone) {
      errors.push(`Missing name or phone: "${line}"`);
      continue;
    }

    validRows.push({ name, phone });
  }

  if (!validRows.length) {
    res.json({ imported: 0, skipped: errors.length, errors });
    return;
  }

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
