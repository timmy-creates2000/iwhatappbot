---
name: PORT env var conflict
description: Don't set PORT as shared env var — each service needs its own PORT
---

Setting `PORT=8080` as a shared Replit env var causes the frontend Vite server to fail because it also reads `PORT` and tries to bind to 8080 (already taken by the API server).

**Fix:** Remove PORT from shared env vars. Set it inline in each workflow command:
- API server workflow: `pnpm --filter @workspace/api-server run dev` (reads PORT from artifact.toml service env = 8080)
- Frontend workflow: `PORT=23863 BASE_PATH=/ pnpm --filter @workspace/app run dev`

**Why:** Both services read `process.env.PORT` but need different values.
