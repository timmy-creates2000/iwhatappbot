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
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
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
// On Render: startCommand runs from repo root = /opt/render/project/src
// Frontend built to: artifacts/app/dist/public  (relative to repo root)
// process.cwd() always equals the repo root when Render runs the start command
if (process.env["NODE_ENV"] === "production") {
  const frontendDist = path.join(process.cwd(), "artifacts", "app", "dist", "public");

  console.log("[frontend] cwd:", process.cwd());
  console.log("[frontend] looking for dist at:", frontendDist);
  console.log("[frontend] exists:", existsSync(frontendDist));

  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    logger.info({ frontendDist }, "Serving frontend static files");
  } else {
    logger.error({ frontendDist }, "Frontend dist NOT found");
    app.get("/{*path}", (_req, res) => {
      res.status(503).send(`
        <h2>Frontend not found</h2>
        <p>Expected at: <code>${frontendDist}</code></p>
        <p>cwd: <code>${process.cwd()}</code></p>
        <p><a href="/api/healthz">API is running ✓</a></p>
      `);
    });
  }
}

export default app;
