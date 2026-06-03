import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAppPassword } from "./middlewares/requireAppPassword";

const app: Express = express();

// ── Logging ──────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: { id: string; method: string; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Restrict to the configured origin in production; allow all in dev
const allowedOrigin = process.env["ALLOWED_ORIGIN"];
app.use(
  cors({
    origin: allowedOrigin ?? true, // true = echo the request origin (dev only)
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-app-password"],
    credentials: false,
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
// 50kb for normal endpoints; bulk import can be larger but capped at 500kb
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth is applied per-route so /whatsapp/status can stay public.
app.use("/api", router);

export default app;
