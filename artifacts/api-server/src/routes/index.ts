import { Router, type IRouter } from "express";
import { requireAppPassword } from "../middlewares/requireAppPassword";
import { whatsappService } from "../lib/whatsapp";
import healthRouter from "./health";
import whatsappRouter from "./whatsapp";
import contactsRouter from "./contacts";
import groupsRouter from "./groups";
import campaignsRouter from "./campaigns";
import logsRouter from "./logs";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";

const router: IRouter = Router();

// ── Public routes (no password needed) ───────────────────────────────────────
router.use(healthRouter);

// Status is public so the UI can always poll connection state without auth
router.get("/whatsapp/status", (req, res): void => {
  res.json(whatsappService.getStatus());
});

// ── Protected routes — everything else requires APP_PASSWORD ─────────────────
router.use(requireAppPassword);

router.use(whatsappRouter);
router.use(contactsRouter);
router.use(groupsRouter);
router.use(campaignsRouter);
router.use(logsRouter);
router.use(dashboardRouter);
router.use(aiRouter);

export default router;
