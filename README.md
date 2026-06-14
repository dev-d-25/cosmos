# Cosmos

Mail and calendar integration app. Sign in with Google, connect Gmail and Google Calendar, and use a Superhuman-style UI for inbox and schedule management.

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS v4
- [shadcn/ui](https://ui.shadcn.com) base components
- [Better Auth](https://www.better-auth.com) (Google OAuth)
- [Drizzle ORM](https://orm.drizzle.team) + Postgres
- [Corsair](https://github.com/corsair-dev/corsair) for Google API access (Gmail + Calendar)

## Setup

1. Install dependencies: `pnpm install`
2. Copy env file and fill in values: `cp .env.example .env`
3. Start the database: `docker compose up -d` (or `./start-database.sh`)
4. Push the schema: `pnpm db:push`
5. Start the dev server: `pnpm dev`

## Scripts

- `pnpm dev` — Next.js dev server
- `pnpm build` / `pnpm start` — production build / start
- `pnpm db:push` / `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` — Drizzle
- `pnpm lint` / `pnpm typecheck` / `pnpm format:write`
