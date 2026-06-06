import path from "path";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";

// Load .env from workspace root regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../.env") }); // fallback for dist/
import app from "./app";
import { logger } from "./lib/logger";
import { whatsappService } from "./lib/whatsapp";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Initialize WhatsApp service after server is ready
  whatsappService.initialize().catch((e: unknown) => {
    logger.error({ err: e }, "WhatsApp initialization failed");
  });
});
