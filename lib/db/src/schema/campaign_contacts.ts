import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignContactsTable = sqliteTable("campaign_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull(),
  contactId: integer("contact_id").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertCampaignContactSchema = createInsertSchema(campaignContactsTable).omit({ id: true, createdAt: true });
export type InsertCampaignContact = z.infer<typeof insertCampaignContactSchema>;
export type CampaignContact = typeof campaignContactsTable.$inferSelect;
