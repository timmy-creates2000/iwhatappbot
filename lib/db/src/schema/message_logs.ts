import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageLogsTable = sqliteTable("message_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id"),
  campaignId: integer("campaign_id"),
  message: text("message"),
  // pending | sent | failed
  status: text("status").notNull().default("pending"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertMessageLogSchema = createInsertSchema(messageLogsTable).omit({ id: true, createdAt: true });
export type InsertMessageLog = z.infer<typeof insertMessageLogSchema>;
export type MessageLog = typeof messageLogsTable.$inferSelect;
