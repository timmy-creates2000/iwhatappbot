import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, messageTemplatesTable } from "@workspace/db";
import {
  ComposeMessageBody,
  CreateTemplateBody,
  DeleteTemplateParams,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

router.post("/ai/compose", async (req, res): Promise<void> => {
  const parsed = ComposeMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { topic, tone, purpose } = parsed.data;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

    if (!apiKey) {
      res.json({ message: topic });
      return;
    }

    const genAI = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert WhatsApp community manager. Write a compelling WhatsApp message for the following:

Topic/Context: ${topic}
Tone: ${tone ?? "professional"}
Purpose: ${purpose ?? "community announcement"}

Requirements:
- Keep it concise (under 200 words)
- Use appropriate WhatsApp formatting (bold with *, emojis where fitting)
- Make it engaging and action-oriented
- Return ONLY the message text, nothing else`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 1024 },
    });

    const text = response.text;
    res.json({ message: text?.trim() ?? topic });
  } catch (err) {
    logger.error({ err }, "AI compose error");
    res.json({ message: topic });
  }
});

router.get("/ai/templates", async (req, res): Promise<void> => {
  const templates = await db
    .select()
    .from(messageTemplatesTable)
    .orderBy(messageTemplatesTable.createdAt);
  res.json(templates);
});

router.post("/ai/templates", async (req, res): Promise<void> => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .insert(messageTemplatesTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(template);
});

router.delete("/ai/templates/:id", async (req, res): Promise<void> => {
  const params = DeleteTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db
    .delete(messageTemplatesTable)
    .where(eq(messageTemplatesTable.id, params.data.id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
