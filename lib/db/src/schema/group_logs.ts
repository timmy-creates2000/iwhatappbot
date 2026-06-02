import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const groupLogsTable = pgTable("group_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id"),
  groupId: integer("group_id"),
  status: text("status").notNull().default("pending"), // pending | added | failed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGroupLogSchema = createInsertSchema(groupLogsTable).omit({ id: true, createdAt: true });
export type InsertGroupLog = z.infer<typeof insertGroupLogSchema>;
export type GroupLog = typeof groupLogsTable.$inferSelect;
