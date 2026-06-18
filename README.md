# Cosmos

A Superhuman-style mail and calendar app. Sign in with Google to manage Gmail and Google Calendar from a single interface, with an AI agent for assisted email and scheduling.

## Features

- **Mail** — Inbox, labels, search, compose (Tiptap editor), keyboard navigation
- **Calendar** — Week/day/month views, event creation, timezone support
- **AI Agent** — Chat interface powered by Vercel AI SDK + MCP for email/calendar actions
- **Multi-account** — Connect multiple Google accounts via Corsair
- **OAuth** — Google sign-in with Better Auth

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Auth | Better Auth (Google OAuth) |
| Database | Drizzle ORM + Postgres |
| Google APIs | [Corsair](https://github.com/corsair-dev/corsair) (Gmail + Calendar) |
| AI | Vercel AI SDK + OpenAI + MCP |
| Language | TypeScript |

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy env and fill in values:
   ```bash
   cp .env.example .env
   ```

3. Start Postgres:
   ```bash
   docker compose up -d
   # or
   ./start-database.sh
   ```

4. Push the schema:
   ```bash
   pnpm db:push
   ```

5. Start dev server:
   ```bash
   pnpm dev
   ```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Random secret for session signing. Generate: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | From [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `DATABASE_URL` | Postgres connection string (Neon pooler URL recommended for serverless) |
| `CORSAIR_KEK` | Encryption key for Corsair. Generate: `openssl rand -base64 32` |
| `KILO_API_KEY` | From [Kilo AI](https://app.kilo.ai/profile) (free models) |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build / start |
| `pnpm check` | Lint + typecheck |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Run tests (Vitest) |
| `pnpm db:push` | Push schema to database |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm format:write` | Format with Prettier |

## Project Structure

```
src/
├── app/            # Next.js App Router pages
│   ├── mail/       # Mail inbox UI
│   ├── calendar/   # Calendar views
│   ├── agent/      # AI chat agent
│   ├── search/     # Mail search
│   └── api/        # API routes (auth, mail, calendar, chat, corsair-mcp)
├── components/     # Shared UI components
├── hooks/          # React hooks
├── lib/            # Utility functions
├── server/         # Server-side code
│   ├── auth.ts     # Auth helpers
│   ├── corsair.ts  # Corsair integration
│   ├── mail/       # Gmail operations
│   ├── calendar/   # Calendar operations
│   ├── chat/       # AI chat logic
│   └── db/         # Drizzle schema + queries
└── types/          # TypeScript types
```
