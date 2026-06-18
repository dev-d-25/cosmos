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
  max: 5,                    // limit pool size for serverless
  idle_timeout: 20,          // close idle connections after 20s
  connect_timeout: 10,       // fail fast on connection issues
});
globalForDb.conn = conn;

export { conn };

export const db = drizzle(conn, { schema });
