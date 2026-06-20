/**
 * In-memory label-count cache.
 *
 * Why this exists:
 *   `resolveCount()` in mail/index.ts reads a label's `messagesTotal` to
 *   paginate the inbox. Gmail's `users.labels.list` does NOT return counts
 *   (only `labels.get` does), so the DB-cached label row never has the
 *   field and every render falls through to a live Gmail API call.
 *
 *   That call costs 2-3s per RSC render. We can't put the count in static
 *   config because it changes every minute as mail arrives. We can, however,
 *   serve it from a process-local cache with a short TTL: the user clicking
 *   around the same inbox hits the cache, and only the first render per
 *   minute pays the Gmail round trip.
 *
 * Key shape: `${accountId}:${labelId}`.
 * Accounts are 1:1 with tenants for the gmail integration, so accountId
 * is a safe scope key — it isolates the cache correctly per-user.
 *
 * TTL: 60 seconds. Anything that mutates the inbox should call
 *   `invalidateLabelCount(accountId, labelId)` so the next render re-fetches.
 *
 * Scope: per Lambda/serverless instance. Vercel may run multiple instances
 * in parallel, so the cache hit rate is bounded by the instance stickiness
 * of the routing layer. That's fine — we only need ONE fetch per minute
 * per (account, label) per instance, not globally.
 */

const TTL_MS = 60_000;

type CacheEntry = { value: number; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function key(tenantId: string, labelId: string): string {
  return `${tenantId}:${labelId}`;
}

/**
 * Return the cached `messagesTotal` for a label, or `null` on miss.
 * Does NOT trigger a fetch — see `getLabelCount` for the fetch-on-miss path.
 */
export function peekLabelCount(
  tenantId: string,
  labelId: string,
): number | null {
  const entry = cache.get(key(tenantId, labelId));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key(tenantId, labelId));
    return null;
  }
  return entry.value;
}

export function setLabelCount(
  tenantId: string,
  labelId: string,
  value: number,
): void {
  cache.set(key(tenantId, labelId), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateLabelCount(
  tenantId: string,
  labelId: string,
): void {
  cache.delete(key(tenantId, labelId));
}

/**
 * Fetch-on-miss wrapper. Calls the provided fetcher on cache miss, caches
 * the result, and returns it. On hit, returns the cached value with no I/O.
 *
 * The fetcher is injected (rather than calling corsair directly) so this
 * module stays free of corsair SDK imports — easier to unit-test, and the
 * SDK object is built per-request by callers anyway.
 */
export async function getLabelCount(
  tenantId: string,
  labelId: string,
  fetcher: () => Promise<number | null>,
): Promise<number | null> {
  const hit = peekLabelCount(tenantId, labelId);
  if (hit !== null) return hit;

  const value = await fetcher();
  if (typeof value === "number") {
    setLabelCount(tenantId, labelId, value);
  }
  return value;
}