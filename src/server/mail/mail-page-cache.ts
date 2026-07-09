import type { MailListResponse } from "./schemas";
import { viewKeyFor } from "./mail-read-model";

// ─── In-memory list cache ──────────────────────────────────
// Module-level Map is unbounded across all tenants by default, which is a
// deploy-safety risk (O(n) invalidation + unbounded growth). Cap it with a
// simple LRU: the oldest entry is evicted once we exceed MAX_CACHE_ENTRIES,
// and a cache hit is promoted to the most-recently-used end (Map preserves
// insertion order, so re-inserting moves an entry to the end).

const MAIL_LIST_CACHE_TTL = 30_000;
const MAX_CACHE_ENTRIES = 500;

const mailListCache = new Map<string, { data: MailListResponse; at: number }>();

export function getMailListCacheKey(
  tenantId: string,
  view: { labelIds?: string[]; query?: string },
  page: number,
): string {
  return `${tenantId}:${viewKeyFor(view)}:${page}`;
}

export function checkMailListCache(
  cacheKey: string,
): MailListResponse | undefined {
  const cached = mailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
    // LRU promotion: move the hit to the most-recently-used end.
    mailListCache.delete(cacheKey);
    mailListCache.set(cacheKey, cached);
    return cached.data;
  }
  return undefined;
}

export function setMailListCache(
  cacheKey: string,
  data: MailListResponse,
): void {
  // Evict the oldest entry (Map preserves insertion order) once at capacity.
  if (mailListCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = mailListCache.keys().next().value;
    if (oldest !== undefined) mailListCache.delete(oldest);
  }
  mailListCache.set(cacheKey, { data, at: Date.now() });
}

export function invalidateMailListCacheForTenant(
  tenantId: string,
  view?: { labelIds?: string[]; query?: string },
): void {
  const prefix = view
    ? `${tenantId}:${viewKeyFor(view)}:`
    : `${tenantId}:`;
  for (const key of Array.from(mailListCache.keys())) {
    if (key.startsWith(prefix)) mailListCache.delete(key);
  }
}
