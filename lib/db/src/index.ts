import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client/http";
import * as schema from "./schema";

const url = process.env["TURSO_DATABASE_URL"];
const authToken = process.env["TURSO_AUTH_TOKEN"];

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL must be set. Get it from your Turso dashboard.",
  );
}

const client = createClient({ url, authToken });

export const db = drizzle(client, { schema });

export * from "./schema";
