import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const stripKeyPrefix = (val: string | undefined, key: string) =>
  val?.startsWith(`${key}=`) ? val.slice(key.length + 1) : val;

const url = stripKeyPrefix(process.env["TURSO_DATABASE_URL"], "TURSO_DATABASE_URL");
const authToken = stripKeyPrefix(process.env["TURSO_AUTH_TOKEN"], "TURSO_AUTH_TOKEN");

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL must be set. Get it from your Turso dashboard.",
  );
}

const client = createClient({ url, authToken });

export const db = drizzle(client, { schema });

export * from "./schema";
