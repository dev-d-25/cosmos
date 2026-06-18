import { cache } from "react";
import { auth } from "@/server/better-auth";
import { headers } from "next/headers";

/**
 * Cached per-request session lookup.
 * React's cache() deduplicates calls within a single server render / action,
 * so multiple calls to getSessionTenantId() in the same request only hit the DB once.
 */
export const getSessionTenantId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session?.user?.id ?? null;
});
