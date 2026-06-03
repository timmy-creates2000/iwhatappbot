import { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual, createHash } from "crypto";

const appPassword = process.env["APP_PASSWORD"];

if (!appPassword) {
  // Crash in production if no password is set — too dangerous to run open
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "APP_PASSWORD environment variable is required in production. Set it before starting the server.",
    );
  }
  // In dev just warn loudly
  console.warn(
    "\x1b[33m[WARN]\x1b[0m APP_PASSWORD is not set — ALL API routes are unprotected. Set APP_PASSWORD in your environment.\n",
  );
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

/**
 * Middleware that checks the X-App-Password header against APP_PASSWORD env.
 * If APP_PASSWORD is not set, the request is allowed through (dev mode only).
 */
export function requireAppPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!appPassword) {
    next();
    return;
  }

  const provided = req.headers["x-app-password"];

  if (typeof provided !== "string" || !safeEqual(provided, appPassword)) {
    res.status(401).json({ error: "Invalid or missing app password" });
    return;
  }

  next();
}
