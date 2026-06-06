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
// On Render the start command is:
//   node artifacts/api-server/dist/index.mjs
// run from the repo root, so process.cwd() = /opt/render/project/src
// The frontend build output is at: artifacts/app/dist/public (relative to repo root)
if (process.env["NODE_ENV"] === "production") {
  // Try candidates in order — first match wins
  const candidates = [
    path.resolve(process.cwd(), "artifacts/app/dist/public"),
    path.resolve(__dirname, "../../app/dist/public"),
    path.resolve(__dirname, "../../../artifacts/app/dist/public"),
  ];

  const frontendDist = candidates.find(existsSync) ?? null;

  if (frontendDist) {
    app.use(express.static(frontendDist));
    // SPA catch-all — serve index.html for any non-API path
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    logger.info({ frontendDist }, "Serving frontend static files");
  } else {
    logger.warn(
      { cwd: process.cwd(), candidates },
      "Frontend dist not found — frontend build may have failed",
    );
    // Show helpful JSON instead of raw 404
    app.get("/", (_req, res) => {
      res.status(200).json({
        status: "API is running",
        note: "Frontend build not found. Check build logs on Render.",
      });
    });
  }
}

export default app;
