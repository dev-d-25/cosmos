import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";
import * as schema from "./schema";

/**
 * Cache the database connection globally.
 * In dev this avoids creating a new connection on every HMR update.
 * In production (Vercel serverless), this allows connection reuse across
 * invocations of the same function instance, avoiding cold-start pool setup.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, {
  max: 10,                   // wider pool — serverless instances multiplex
  idle_timeout: 600,         // 10 min — keep TLS warm between user bursts
  connect_timeout: 30,       // tolerate Neon hiccups instead of failing clicks
  prepare: false,            // skip server-side prepared stmt cache
                             // (the usual source of "conn in use" under churn)
});
globalForDb.conn = conn;

export { conn };

export const db = drizzle(conn, { schema });
