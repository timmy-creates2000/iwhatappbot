---
name: DB setup for dev
description: CommGrowth uses libSQL/SQLite (not Postgres) — needs absolute TURSO_DATABASE_URL and drizzle-kit push before first run
---

The project uses `@libsql/client` + Drizzle ORM with a local SQLite file for development.

**Rule:** Always use an absolute path for `TURSO_DATABASE_URL`. A relative `file:./dev.db` creates different files depending on each service's working directory (lib/db/ vs artifacts/api-server/).

**Correct env var (development):**
```
TURSO_DATABASE_URL=file:/home/runner/workspace/dev.db
```

**After changing DB schema:**
```bash
TURSO_DATABASE_URL=file:/home/runner/workspace/dev.db pnpm --filter @workspace/db run push
```

**Why:** `drizzle-kit push` resolves `./dev.db` relative to `lib/db/`. The API server resolves it relative to `artifacts/api-server/`. These are two different files. Using the absolute path ensures both point to the same SQLite file.

**How to apply:** Set the development env var to the absolute path, then run push. Restart the workflow after push.
