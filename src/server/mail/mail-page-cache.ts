import type { MailListResponse } from "./schemas";

// ─── In-memory list cache ──────────────────────────────────
// Module-level Map is unbounded across all tenants by default, which is a
// deploy-safety risk (O(n) invalidation + unbounded growth). Cap it with a
// simple insertion-order LRU: the oldest entries are evicted once we exceed
// MAX_CACHE_ENTRIES. Invalidation stays O(tenant) via key-prefix scans, which
// is acceptable because eviction bounds total size.

const MAIL_LIST_CACHE_TTL = 30_000;
const MAX_CACHE_ENTRIES = 500;

const mailListCache = new Map<string, { data: MailListResponse; at: number }>();

function hashViewToken(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function viewToken(view: {
  labelIds?: string[];
  query?: string;
}): string {
  if (view.labelIds?.length) return `l:${[...view.labelIds].sort().join("+")}`;
  if (view.query) {
    if (!view.labelIds) return `q:${hashViewToken(view.query)}`;
    return `s:${hashViewToken(view.query)}`;
  }
  return "l:INBOX";
}

export function getMailListCacheKey(
  tenantId: string,
  view: { labelIds?: string[]; query?: string },
  page: number,
): string {
  return `${tenantId}:${viewToken(view)}:${page}`;
}

export function checkMailListCache(
  cacheKey: string,
): MailListResponse | undefined {
  const cached = mailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
    return cached.data;
  }
  return undefined;
}

export function setMailListCache(
  cacheKey: string,
  data: MailListResponse,
): void {
  // Evict the oldest entry (Map preserves insertion order) before adding a new
  // one once we're at capacity. This bounds memory even with many tenants.
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
    ? `${tenantId}:${viewToken(view)}:`
    : `${tenantId}:`;
  for (const key of Array.from(mailListCache.keys())) {
    if (key.startsWith(prefix)) mailListCache.delete(key);
  }
}
