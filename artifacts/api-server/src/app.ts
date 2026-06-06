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
const allowedOrigin = process.env["ALLOWED_ORIGIN"];
app.use(
  cors({
    origin: allowedOrigin ?? true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-app-password"],
    credentials: false,
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Frontend static files (production) ───────────────────────────────────────
// Bundle lands at:   <repo>/artifacts/api-server/dist/index.mjs
//   → __dirname  =   <repo>/artifacts/api-server/dist
// Frontend build at: <repo>/artifacts/app/dist/public
//   → relative  =   ../../app/dist/public  (from __dirname)
// Also try process.cwd() which = repo root on Render
if (process.env["NODE_ENV"] === "production") {
  const fromDirname = path.resolve(__dirname, "../../app/dist/public");
  const fromCwd     = path.resolve(process.cwd(), "artifacts/app/dist/public");

  const frontendDist = existsSync(fromDirname) ? fromDirname
    : existsSync(fromCwd) ? fromCwd
    : null;

  logger.info({
    __dirname,
    cwd: process.cwd(),
    fromDirname,
    fromCwd,
    found: frontendDist,
  }, "Frontend dist lookup");

  if (frontendDist) {
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    logger.info({ frontendDist }, "Serving frontend static files");
  } else {
    logger.error({ fromDirname, fromCwd }, "Frontend dist NOT found — frontend build failed");
    // Helpful fallback instead of raw 404
    app.get("*", (_req, res) => {
      res.status(503).send(`
        <h1>Frontend not built</h1>
        <p>The React app build failed. Check Render build logs.</p>
        <p>Expected at: <code>${fromDirname}</code></p>
        <p>API is running at: <a href="/api/healthz">/api/healthz</a></p>
      `);
    });
  }
}

export default app;
