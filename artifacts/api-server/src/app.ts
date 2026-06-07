import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
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
if (process.env["NODE_ENV"] === "production") {
  // Resolve __dirname for both ESM (dist bundle) and tsx (src)
  const _dirname = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const cwd = process.cwd();

  // All candidate paths — first one that exists wins
  const candidates = [
    path.resolve(cwd, "artifacts/app/dist/public"),
    path.resolve(_dirname, "../../app/dist/public"),
    path.resolve(_dirname, "../../../artifacts/app/dist/public"),
    path.resolve(_dirname, "../../../../artifacts/app/dist/public"),
  ];

  const frontendDist = candidates.find(existsSync) ?? null;

  // Always log so we can see in Render logs what happened
  console.log("[app] cwd:", cwd);
  console.log("[app] __dirname:", _dirname);
  console.log("[app] candidates:", candidates);
  console.log("[app] frontendDist:", frontendDist);

  if (frontendDist) {
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    logger.info({ frontendDist }, "Serving frontend static files");
  } else {
    logger.error({ cwd, candidates }, "Frontend dist NOT found");
    app.get("*", (_req, res) => {
      // Show diagnostic page instead of raw 404
      let listing = "";
      try { listing = readdirSync(cwd).join(", "); } catch { listing = "error reading cwd"; }
      res.status(503).send(`
        <h2>Frontend not found</h2>
        <p><b>cwd:</b> ${cwd}</p>
        <p><b>__dirname:</b> ${_dirname}</p>
        <p><b>Tried:</b><br>${candidates.join("<br>")}</p>
        <p><b>cwd contents:</b> ${listing}</p>
        <p><a href="/api/healthz">API healthz</a></p>
      `);
    });
  }
}

export default app;
