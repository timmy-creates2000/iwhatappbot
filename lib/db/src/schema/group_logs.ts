import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const groupLogsTable = sqliteTable("group_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id"),
  groupId: integer("group_id"),
  // pending | added | failed
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertGroupLogSchema = createInsertSchema(groupLogsTable).omit({ id: true, createdAt: true });
export type InsertGroupLog = z.infer<typeof insertGroupLogSchema>;
export type GroupLog = typeof groupLogsTable.$inferSelect;
