import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

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

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Frontend static files (production) ───────────────────────────────────────
// In production on Render the frontend is pre-built and served from the same
// Express process, so no separate static-site service is needed and CORS/
// VITE_API_URL chicken-and-egg problems disappear entirely.
if (process.env["NODE_ENV"] === "production") {
  const frontendDist = path.resolve(process.cwd(), "artifacts/app/dist/public");
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA catch-all — serve index.html for any non-API path
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    logger.info({ frontendDist }, "Serving frontend static files");
  } else {
    logger.warn(
      { frontendDist },
      "Frontend dist not found — run the frontend build first",
    );
  }
}

export default app;
