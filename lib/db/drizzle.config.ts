import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

// Load .env from workspace root when running drizzle-kit directly
config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env["TURSO_DATABASE_URL"];
const authToken = process.env["TURSO_AUTH_TOKEN"];

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL must be set. Add it to your .env file at the workspace root.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: { url, authToken },
});
