import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  messageTemplate: text("message_template").notNull(),
  // draft | running | paused | completed | failed | cancelled
  status: text("status").notNull().default("draft"),
  startDate: text("start_date"),
  delayBetweenMessages: integer("delay_between_messages").default(1000), // in milliseconds
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
