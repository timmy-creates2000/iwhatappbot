# CommGrowth — WhatsApp Community Growth Manager

A full-stack web app for managing WhatsApp community growth: bulk messaging campaigns, contact management, group management, and AI-powered message composition.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/app run dev` — run the React frontend (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `GEMINI_API_KEY` — Google Gemini AI for message composition
- Optional env: `SESSION_SECRET` — Express session secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS v4, shadcn/ui, TanStack Query, Wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- WhatsApp: `@whiskeysockets/baileys` (multi-device)
- AI: `@google/genai` (Gemini 2.5 Flash)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for routes + schemas)
- `lib/api-zod/src/generated/api.ts` — generated Zod validation schemas
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/db/src/schema/` — Drizzle ORM table definitions
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/whatsapp.ts` — Baileys WhatsApp service singleton
- `artifacts/app/src/pages/` — React page components
- `artifacts/app/src/components/` — Shared UI components

## Architecture decisions

- **Contract-first API**: All routes are defined in OpenAPI spec first, then Zod + React Query hooks are generated. Never add routes without updating the spec.
- **WhatsApp as optional**: The app works without WhatsApp connected. Campaigns will mark messages as failed if WA is not connected. Connect at `/connect`.
- **Baileys lazy init**: WhatsApp service initializes on server startup with a `.wa-auth/` directory for persistent auth state.
- **AI fallback**: If `GEMINI_API_KEY` is missing, the AI compose endpoint returns the raw topic text as the message.
- **Tags stored as JSON**: Contact tags are stored as `json` in Postgres (array of strings).

## Product

- **Dashboard**: Stats overview (contacts, groups, messages, campaigns) + recent activity + WhatsApp connection status
- **Contacts**: CRUD, search, tags/notes, bulk CSV import
- **Groups**: CRUD, sync from WhatsApp, add members to groups
- **Campaigns**: Create bulk messaging campaigns, assign contacts, run/pause/cancel
- **AI Compose**: Generate WhatsApp messages via Gemini AI with tone/purpose controls; save as templates
- **Logs**: Message delivery logs + group activity logs with status filtering
- **Connect**: WhatsApp QR code login page

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing the OpenAPI spec, always run `pnpm --filter @workspace/api-spec run codegen` before rebuilding
- After changing DB schema files, run `pnpm --filter @workspace/db run push` to apply to dev DB
- Baileys stores auth in `.wa-auth/` at the project root — delete this directory to force re-login
- The API server bundles Baileys with esbuild; `@whiskeysockets/baileys` and `protobufjs` must be in `dependencies` (not devDependencies)
- Contacts endpoint uses `PATCH` for updates (not `PUT`) — Orval generates `useUpdateContact` which calls PATCH

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
