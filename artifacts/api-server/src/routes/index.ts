import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whatsappRouter from "./whatsapp";
import contactsRouter from "./contacts";
import groupsRouter from "./groups";
import campaignsRouter from "./campaigns";
import logsRouter from "./logs";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whatsappRouter);
router.use(contactsRouter);
router.use(groupsRouter);
router.use(campaignsRouter);
router.use(logsRouter);
router.use(dashboardRouter);
router.use(aiRouter);

export default router;
