"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
import {
  countByLabel,
  getAccountIdForTenant,
  listMessages,
  listByLabel,
  upsertManyByEntityIds,
  type RawMessageEntity,
  type UpsertItem,
} from "@/server/db/mail-entities";
import { toListItem } from "./transformers";
import {
  GetProfileApiResponseSchema,
  InboxRefreshResponseSchema,
  MailLabelSchema,
  MailListItemSchema,
  PAGE_SIZE,
} from "./schemas";
import type {
  MailLabel,
  MailListItem,
  MailListResponse,
  MailPageData,
  MailProfile,
} from "./schemas";
import { MAIL_LABELS } from "@/lib/mail/labels";

const INBOX_LABEL = "INBOX";
const ENRICH_HEADERS = ["Subject", "From", "To", "Date"];

// ─── Response cache (per-tenant) ──────────────────────────────────────────
//
// Keys are scoped by tenantId so that an archive in tenant A cannot
// invalidate tenant B's pages. The full key shape is:
//
//   `${tenantId}:${view}:${page}`
//
// `view` is one of:
//   - `l:${labelId}`      → label view (e.g. l:INBOX, l:STARRED)
//   - `q:${queryHash}`    → gmailQuery view (e.g. q:archive = -in:inbox)
//   - `s:${searchHash}`   → free-text search
//
// The view token is hashed so weird characters in a query can't break the
// key. Length is truncated to keep the key short.

const mailListCache = new Map<string, { data: MailListResponse; at: number }>();
const MAIL_LIST_CACHE_TTL = 30_000;

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

function getMailListCacheKey(
  tenantId: string,
  view: { labelIds?: string[]; query?: string },
  page: number,
): string {
  return `${tenantId}:${viewToken(view)}:${page}`;
}

function invalidateMailListCacheForTenant(
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

function isRowEnriched(row: { data: Record<string, unknown> }): boolean {
  const d = row.data;
  if (typeof d.from === "string" && d.from.trim() !== "") return true;
  const payload = d.payload as
    | { headers?: Array<{ name?: string; value?: string }> }
    | undefined;
  const headers = payload?.headers;
  if (Array.isArray(headers)) {
    const hasFrom = headers.some(
      (h) =>
        h.name?.toLowerCase() === "from" &&
        typeof h.value === "string" &&
        h.value.trim() !== "",
    );
    if (hasFrom) return true;
  }
  return false;
}

function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      status?: number;
      code?: number | string;
      message?: string;
    };
    if (e.status) return `HTTP ${e.status}`;
    if (e.code != null) return `code ${e.code}`;
    if (e.message) return e.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

async function enrichStubs(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const t0 = Date.now();

  const existingRows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const enrichedIds = new Set<string>();
  for (const row of existingRows) {
    if (isRowEnriched(row)) {
      enrichedIds.add(row.data.id);
    }
  }
  const needsEnrichment = ids.filter((id) => !enrichedIds.has(id));

  if (needsEnrichment.length === 0) {
    console.log(`[mail] All ${ids.length} IDs already enriched, skipping Gmail`);
    return;
  }

  let succeeded = 0;
  let failed = 0;

  const accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    console.log(
      `[mail] Enriched 0/${needsEnrichment.length} — no access token available; stubs will remain unenriched`,
    );
    return;
  }

  async function fetchWithRetry(url: string, retries = 3, delayMs = 1000): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 429 && attempt < retries) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delayMs * Math.pow(2, attempt);
        console.log(`[mail] enrichStubs: rate limited (429), retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    }
    throw new Error("exhausted retries");
  }

  const results = await Promise.allSettled(
    needsEnrichment.map(async (id) => {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&${ENRICH_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&")}`;
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Record<string, unknown>;
      return { id, raw };
    }),
  );

  results.forEach((r) => {
    if (r.status === "fulfilled") {
      succeeded++;
    } else {
      failed++;
      console.warn(`[mail] enrichStubs: failed for item: ${describeError(r.reason)}`);
    }
  });

  const upsertItems: UpsertItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { id, raw } = r.value;
    try {
      const payload = raw.payload as
        | { headers?: Array<{ name?: string; value?: string }> }
        | undefined;
      const headers = payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
      const subject = get("Subject");
      const from = get("From");
      const to = get("To");

      upsertItems.push({
        entityId: id,
        data: {
          ...(raw as RawMessageEntity),
          id,
          subject,
          from,
          to,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      console.log(`[mail] enrich parse error for ${id}: ${describeError(err)}`);
    }
  }

  if (upsertItems.length > 0) {
    try {
      await upsertManyByEntityIds(accountId, upsertItems);
    } catch (err) {
      console.log(`[mail] bulk upsert failed (${upsertItems.length} items): ${describeError(err)}`);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[mail] Enriched ${succeeded}/${needsEnrichment.length} | failed=${failed} in ${elapsed}ms`,
  );
}

/**
 * Raw fetch of a single message with full body, then atomic upsert via the
 * native ON CONFLICT helper. Bypasses the corsair SDK's `messages.get`,
 * which would auto-persist through its 3-query upsertByEntityId.
 *
 * Single Gmail API call + single DB round-trip. Returned shape mirrors
 * the SDK response so callers can swap it in transparently.
 *
 * If Gmail returns 401 (token expired mid-session), refreshes via the
 * SDK's `_refreshAuth` hook and retries once. This is the same pattern
 * `getAttachmentContent` uses and is necessary because `get_access_token`
 * can return an expired token (the SDK only refreshes on its own clock,
 * not on demand from callers).
 */
async function fetchAndPersistFullBody(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  const tokenResult = await fetchGmailMessageWithRefresh(client, id);
  if (!tokenResult.ok) {
    throw tokenResult.error;
  }
  const raw = tokenResult.value;

  const payload = raw.payload as
    | { headers?: Array<{ name?: string; value?: string }> }
    | undefined;
  const headers = payload?.headers ?? [];
  const get = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;

  // NOTE: do NOT store `body: raw.payload` here. The corsair SDK's
  // messages entity schema declares `body: z.string().optional()` and
  // validates the row on every read via findByEntityId. Storing an object
  // there throws ZodError → "Invalid request" 400 on the click. The
  // payload is already preserved separately and the getMessage hasBody
  // check inspects payload.parts[].body.data directly.
  await upsertManyByEntityIds(accountId, [
    {
      entityId: id,
      data: {
        ...(raw as RawMessageEntity),
        id,
        subject: get("Subject"),
        from: get("From"),
        to: get("To"),
        createdAt: new Date(),
      },
    },
  ]);

  return raw;
}

/**
 * Fetch a Gmail message body with refresh-on-401 retry. Returns either
 * `{ ok: true, value }` or `{ ok: false, error }` so the caller can
 * distinguish a successful retry from a real failure.
 *
 * The retry fires at most once. After that, the error is returned.
 */
async function fetchGmailMessageWithRefresh(
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: Error }
> {
  let accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    return { ok: false, error: new Error("no_access_token") };
  }

  const doFetch = async (token: string): Promise<Response> => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  };

  let response = await doFetch(accessToken);
  if (response.status === 401) {
    const gmail = client.gmail as unknown as {
      _refreshAuth?: () => Promise<string>;
    };
    if (gmail._refreshAuth) {
      try {
        accessToken = await gmail._refreshAuth();
        response = await doFetch(accessToken);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: new Error(
        `gmail_${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      ),
    };
  }

  const value = (await response.json()) as Record<string, unknown>;
  return { ok: true, value };
}

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

function sortByReceivedDesc(items: MailListItem[]): MailListItem[] {
  return [...items].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

function rowsToListItems(
  rows: Array<{ data: Record<string, unknown> }>,
): MailListItem[] {
  const seen = new Set<string>();
  return rows
    .map((r) => toListItem(r))
    .filter((item): item is MailListItem => {
      if (item.id === "" || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

/**
 * A view is the (labelIds ∪ query) tuple that defines what the user is
 * looking at. Classified into:
 *   - label  : one or more labels. Uses label.messagesTotal / countByLabel.
 *   - query  : a Gmail query without a label (e.g. ARCHIVE = -in:inbox).
 *              Uses local cache count + resultSizeEstimate fallback.
 *   - search : free-text `q`. No exact count; returns count=null.
 */
type ViewKind = "label" | "query" | "search";

function classifyView(view: {
  labelIds?: string[];
  query?: string;
}): ViewKind {
  if (view.query) return view.labelIds?.length ? "label" : "search";
  return "label";
}

/**
 * Resolve the count for a view. Returns:
 *   - `count: number` for label and query views (truth from cache + label row)
 *   - `count: null` for free-text search (no exact count available)
 *   - `degraded: true` when the only available source is the local DB and
 *     it disagrees with the label row (cache lag).
 *
 * Order of preference (label views):
 *   1. cached label.data.messagesTotal from the corsair_entities.labels row
 *      (the truth Gmail gave us on the last labels.list call)
 *   2. countByLabel() from the local DB (exact SQL count, GIN-indexed)
 *   3. client.gmail.db.messages.count() (unfiltered INBOX fallback)
 *
 * Query views (e.g. ARCHIVE) fall through to countByLabel against the
 * `query` substring. There is no exact Gmail count for arbitrary queries;
 * `resultSizeEstimate` is a rough number and we surface it via the page
 * header (count may be 0 → pager hidden), not via this helper.
 */
async function resolveCount(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
): Promise<{ count: number | null; degraded: boolean }> {
  if (classifyView(view) === "search") {
    return { count: null, degraded: false };
  }

  if (view.labelIds?.length === 1) {
    const labelId = view.labelIds[0];
    if (!labelId) {
      const dbCount = await countByLabel(accountId, view.labelIds);
      return { count: dbCount, degraded: false };
    }
    try {
      // 1. Try cached label from DB first
      const labels = await client.gmail.db.labels.list();
      const row = labels.find(
        (l) => (l.data as Record<string, unknown>).id === labelId,
      );
      const labelTotal = row
        ? ((row.data as Record<string, unknown>).messagesTotal as
            | number
            | undefined)
        : undefined;
      if (typeof labelTotal === "number" && labelTotal >= 0) {
        return { count: labelTotal, degraded: false };
      }
    } catch {
      // fall through
    }

    // 2. Gmail's labels.list may not include messagesTotal; fetch the
    //    single label via labels.get which always returns the count.
    try {
      const label = await client.gmail.api.labels.get({ id: labelId });
      const apiTotal = (label as Record<string, unknown>).messagesTotal as
        | number
        | undefined;
      if (typeof apiTotal === "number" && apiTotal >= 0) {
        return { count: apiTotal, degraded: false };
      }
    } catch {
      // fall through to DB count
    }
  }

  const dbCount = view.labelIds?.length
    ? await countByLabel(accountId, view.labelIds)
    : await client.gmail.db.messages.count();

  return { count: dbCount, degraded: false };
}

/**
 * Compute cacheState and coverage for the response.
 *
 *   coverage = dbCount / count
 *   cacheState = "empty"   if dbCount === 0
 *              = "partial" if dbCount <  count
 *              = "full"    otherwise
 *
 * The UI renders a "Syncing X/Y" pill when cacheState !== "full".
 */
function computeCacheState(
  count: number | null,
  dbCount: number,
): { cacheState: "full" | "partial" | "empty"; coverage: number } {
  if (dbCount === 0) return { cacheState: "empty", coverage: 0 };
  if (count == null || count === 0) {
    return { cacheState: "full", coverage: 1 };
  }
  if (dbCount >= count) return { cacheState: "full", coverage: 1 };
  return { cacheState: "partial", coverage: dbCount / count };
}

function buildPagination(
  page: number,
  count: number | null,
): {
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  hasPrev: boolean;
} {
  if (count == null) {
    // No exact count (search). Page is whatever was requested; the UI
    // can't show pagination math without a total.
    return {
      page,
      totalPages: null,
      hasMore: false,
      hasPrev: page > 1,
    };
  }
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  return {
    page: clampedPage,
    totalPages,
    hasMore: clampedPage < totalPages,
    hasPrev: clampedPage > 1,
  };
}

/**
 * Empty response used when we can't return anything (no session, etc).
 * Page is 1, count is 0, cacheState empty.
 */
function emptyResponse(): MailListResponse {
  return {
    items: [],
    count: 0,
    page: 1,
    totalPages: 1,
    hasMore: false,
    hasPrev: false,
    cacheState: "empty",
    coverage: 0,
    source: "cache",
    degraded: false,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface GetMailListOpts {
  /**
   * 1-based page number. Read from the URL on the client and SSR.
   * Defaults to 1.
   */
  page?: number;
  /**
   * Label id filter. Defaults to ["INBOX"] when not in search/query mode.
   */
  labelIds?: string[];
  /**
   * Gmail query string. Mutually exclusive with labelIds (q wins).
   */
  q?: string;
  /**
   * Gmail-side pagination token (for the "still pulling from Gmail" path).
   * Most callers don't pass this — the URL is the source of truth for page.
   */
  pageToken?: string | null;
}

/**
 * The single entry point for paginated mail. Always returns the v2
 * response shape:
 *
 *   { items, count, page, totalPages, hasMore, hasPrev,
 *     cacheState, coverage, source, degraded }
 *
 * Read paths:
 *   - Filtered label view (labelIds.length > 1 OR labelIds[0] !== INBOX):
 *     SQL-level GIN filter via listByLabel.
 *   - Unfiltered INBOX (labelIds = ["INBOX"]): SQL filter via listMessages.
 *   - Query view (labelDef.gmailQuery, e.g. ARCHIVE):
 *     SQL filter via listMessages with an in-DB match for the query.
 *   - Search (free-text q): Gmail API call directly; no DB cache.
 *
 * The function is read-only — it does NOT mutate Gmail. Mutations live
 * in the archiveThread / trashThread / etc. action helpers.
 */
export async function getMailList(
  opts: GetMailListOpts = {},
): Promise<MailListResponse> {
  const ctx = await getClient();
  if (!ctx) return emptyResponse();
  const { tenantId, accountId, client } = ctx;

  const q = opts.q;
  const labelIds = q ? [] : (opts.labelIds ?? [INBOX_LABEL]);
  const isFilteredLabel = isFilteredLabelView(labelIds);
  const isQueryView = classifyView({ labelIds, query: q }) === "query";
  const isSearchView = classifyView({ labelIds, query: q }) === "search";
  const view = { labelIds, query: q };

  // Page is 1-based externally. Internally 0-based.
  // Clamp non-finite / non-positive / Infinity inputs to 1.
  const rawPage = opts.page ?? 1;
  const finitePage = Number.isFinite(rawPage) ? rawPage : 1;
  const requestedPage = Math.max(1, Math.floor(finitePage));

  // ── Response cache (per-tenant, view-scoped) ──────────────────────────
  const cacheKey = getMailListCacheKey(tenantId, view, requestedPage);
  const cached = mailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
    return cached.data;
  }

  let result: MailListResponse;
  if (isSearchView) {
    result = await getMailListFromSearch(
      accountId, client, q!, requestedPage, labelIds,
    );
  } else if (isFilteredLabel || isQueryView) {
    result = await getMailListFromFilteredView(
      accountId, client, view, requestedPage,
    );
  } else {
    result = await getMailListFromInbox(
      accountId, client, view, requestedPage, opts.pageToken ?? null,
    );
  }

  mailListCache.set(cacheKey, { data: result, at: Date.now() });
  return result;
}

function isFilteredLabelView(labelIds: string[] | undefined): boolean {
  if (!labelIds || labelIds.length === 0) return false;
  return labelIds.length > 1 || labelIds[0] !== INBOX_LABEL;
}

async function getMailListFromSearch(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  q: string,
  page: number,
  labelIds: string[],
): Promise<MailListResponse> {
  // Search empty response: pager is hidden (count=null, totalPages=null).
  const searchEmpty = (): MailListResponse => ({
    items: [],
    count: null,
    page,
    totalPages: null,
    hasMore: false,
    hasPrev: page > 1,
    cacheState: "full",
    coverage: 1,
    source: "live",
    degraded: false,
  });

  // Free-text search: no cached count. Always a Gmail round-trip for the
  // page contents (TanStack Query is responsible for the per-id metadata
  // cache that warms subsequent page loads).
  let apiResult: Record<string, unknown>;
  try {
    apiResult = (await client.gmail.api.messages.list({
      userId: "me",
      maxResults: PAGE_SIZE,
      ...(page > 1 ? { pageToken: undefined } : {}),
      q,
      includeSpamTrash: true,
    })) as Record<string, unknown>;
  } catch (err) {
    console.error(`[mail] search error for q="${q}": ${describeError(err)}`);
    return searchEmpty();
  }

  if (!apiResult || Object.keys(apiResult).length === 0) {
    return searchEmpty();
  }

  const messages = (apiResult.messages ?? []) as Array<{ id?: string }>;
  const ids = messages
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) {
    return searchEmpty();
  }

  await enrichStubs(accountId, client, ids);

  const existingRows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const rowByEntityId = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    rowByEntityId.set(row.data.id, row);
  }

  const items: MailListItem[] = [];
  for (const id of ids) {
    const row = rowByEntityId.get(id);
    if (row && isRowEnriched(row)) {
      const item = toListItem(row);
      if (item.id) items.push(item);
    }
  }

  return {
    items,
    count: null,
    page,
    totalPages: null,
    hasMore: false,
    hasPrev: page > 1,
    cacheState: "full",
    coverage: 1,
    source: "live",
    degraded: false,
  };
}

async function getMailListFromFilteredView(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  page: number,
): Promise<MailListResponse> {
  const offset = (page - 1) * PAGE_SIZE;
  const labelIds = view.labelIds ?? [];

  let rows = await listByLabel(accountId, labelIds, {
    limit: PAGE_SIZE,
    offset,
  });

  const stubIds = rows
    .filter((r) => !isRowEnriched(r))
    .map((r) => r.data.id)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    rows = await listByLabel(accountId, labelIds, { limit: PAGE_SIZE, offset });
  }

  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  const dbCount = await countByLabel(accountId, labelIds);
  const { cacheState, coverage } = computeCacheState(count, dbCount);
  const { page: clampedPage, totalPages, hasMore, hasPrev } =
    buildPagination(page, count);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "cache",
    degraded,
  };
}

async function getMailListFromInbox(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  page: number,
  pageToken: string | null,
): Promise<MailListResponse> {
  const offset = (page - 1) * PAGE_SIZE;

  // If the caller passed a Gmail-side pageToken (rare; URL-as-truth
  // shouldn't reach here), advance from Gmail directly.
  if (pageToken) {
    return getMailListFromGmailToken(accountId, client, view, page, pageToken);
  }

  // Otherwise read from DB at the requested offset.
  let rows = await listMessages(accountId, {
    limit: PAGE_SIZE,
    offset,
  });

  const stubIds = rows
    .filter((r) => !isRowEnriched(r))
    .map((r) => (r.data as Record<string, unknown>).id as string)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    rows = await listMessages(accountId, { limit: PAGE_SIZE, offset });
  }

  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  // coverage = rows we have for this view / count. For unfiltered INBOX
  // we count messages with the INBOX label (consistent with resolveCount's
  // countByLabel fallback). Using client.gmail.db.messages.count() here
  // would mix "all account messages" with "INBOX messages", breaking the
  // coverage pill.
  const dbCount = await countByLabel(accountId, [INBOX_LABEL]);
  const { cacheState, coverage } = computeCacheState(count, dbCount);
  const { page: clampedPage, totalPages, hasMore, hasPrev } =
    buildPagination(page, count);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "cache",
    degraded,
  };
}

async function getMailListFromGmailToken(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  page: number,
  pageToken: string,
): Promise<MailListResponse> {
  const apiResult = (await client.gmail.api.messages.list({
    userId: "me",
    maxResults: PAGE_SIZE,
    pageToken,
    labelIds: view.labelIds ?? [INBOX_LABEL],
  })) as Record<string, unknown>;

  const ids = ((apiResult.messages ?? []) as Array<{ id?: string }>)
    .map((m) => m.id)
    .filter((id: unknown): id is string => typeof id === "string");

  if (ids.length > 0) {
    await enrichStubs(accountId, client, ids);
  }

  const rows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  const dbCount = await countByLabel(accountId, [INBOX_LABEL]);
  const { cacheState, coverage } = computeCacheState(count, dbCount);
  const { page: clampedPage, totalPages, hasMore, hasPrev } =
    buildPagination(page, count);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "live",
    degraded,
  };
}

// ─── Single-message reads (unchanged from previous commit) ──────────────

export async function getMessage(
  id: string,
  opts: { force?: boolean } = {},
): Promise<{
  message: Record<string, unknown>;
  source: "cache" | "live";
} | null> {
  const ctx = await getClient();
  if (!ctx) return null;
  const { accountId, client } = ctx;

  if (!opts.force) {
    const cached = await client.gmail.db.messages.findByEntityId(id);
    if (cached?.data?.payload) {
      const hasBody = cached.data.body
        || cached.data.payload.body?.data
        || cached.data.payload.parts?.some(
            (p: { body?: { data?: string } }) => !!p.body?.data,
          );
      if (hasBody) {
        return {
          message: cached.data as Record<string, unknown>,
          source: "cache",
        };
      }
    }
  }

  const full = await fetchAndPersistFullBody(accountId, client, id);

  return { message: full, source: "live" };
}

/**
 * Fire-and-forget full-body fetch for the prefetch path. Writes to the
 * local DB; the next getMessage(id) call on the same id returns from cache.
 */
export async function prefetchFullBody(
  id: string,
): Promise<{ id: string; ok: boolean; error?: string }> {
  const ctx = await getClient();
  if (!ctx) return { id, ok: false, error: "unauthenticated" };
  try {
    await fetchAndPersistFullBody(ctx.accountId, ctx.client, id);
    return { id, ok: true };
  } catch (err) {
    return {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Refresh: user-initiated sync ────────────────────────────────────────

export async function refreshInbox(): Promise<{ synced: number }> {
  const ctx = await getClient();
  if (!ctx) return { synced: 0 };
  const { tenantId, accountId, client } = ctx;

  invalidateMailListCacheForTenant(tenantId);

  const inboxDef = MAIL_LABELS.find((l) => l.id === "INBOX");
  let labelIds: string[] | undefined;
  let viewQuery: string | undefined;
  if (inboxDef?.gmailQuery) {
    viewQuery = inboxDef.gmailQuery;
    labelIds = undefined;
  } else {
    labelIds = [INBOX_LABEL];
  }

  // Phase 1: sync message IDs and warm the cache.
  const syncResult = await syncLabelFromGmail(
    accountId, client, PAGE_SIZE, labelIds, viewQuery,
  );

  // Phase 2: refresh label.messagesTotal for every label so the next
  // resolveCount() reads the fresh count. Without this, the count would
  // only update when the sidebar's useMailLabels re-runs.
  try {
    await client.gmail.api.labels.list({});
  } catch (err) {
    console.log(`[mail] refreshInbox: labels.list failed: ${describeError(err)}`);
  }

  invalidateMailListCacheForTenant(tenantId);

  return { synced: syncResult.fetched };
}

async function syncLabelFromGmail(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  limit: number,
  labelIds?: string[],
  q?: string,
): Promise<{ nextPageToken: string | null; resultSizeEstimate: number | null; fetched: number }> {
  let listResult: Record<string, unknown>;
  try {
    listResult = (await client.gmail.api.messages.list({
      userId: "me",
      maxResults: limit,
      ...(labelIds?.length ? { labelIds } : {}),
      ...(q ? { q, includeSpamTrash: true } : {}),
    })) as Record<string, unknown>;
  } catch (err) {
    console.error(`[mail] syncLabelFromGmail: Gmail API error: ${describeError(err)}`);
    return { nextPageToken: null, resultSizeEstimate: null, fetched: 0 };
  }

  if (!listResult || Object.keys(listResult).length === 0) {
    console.error(`[mail] syncLabelFromGmail: empty response from Gmail API`);
    return { nextPageToken: null, resultSizeEstimate: null, fetched: 0 };
  }

  const messages = (listResult.messages ?? []) as Array<{ id?: string }>;
  const ids = messages
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  const resultSizeEstimate =
    (listResult.resultSizeEstimate as number | null) ?? null;

  if (ids.length === 0) {
    return { nextPageToken: null, resultSizeEstimate, fetched: 0 };
  }

  await enrichStubs(accountId, client, ids);

  return {
    nextPageToken:
      ids.length >= limit ? ((listResult.nextPageToken as string | null) ?? null) : null,
    resultSizeEstimate,
    fetched: ids.length,
  };
}

// ─── Profile ──────────────────────────────────────────────────────────────

export async function markAsRead(
  ids: string[],
): Promise<{ marked: number }> {
  const ctx = await getClient();
  if (!ctx || ids.length === 0) return { marked: 0 };

  const { client, tenantId } = ctx;
  invalidateMailListCacheForTenant(tenantId);
  await client.gmail.api.messages.batchModify({
    ids,
    removeLabelIds: ["UNREAD"],
  });

  return { marked: ids.length };
}

export async function getLabels(): Promise<MailLabel[]> {
  const ctx = await getClient();
  if (!ctx) return [];
  const { client } = ctx;

  const cached = await client.gmail.db.labels.list();
  if (cached.length > 0) {
    return cached
      .map((r) => MailLabelSchema.safeParse(r.data))
      .filter(
        (result): result is { success: true; data: MailLabel } =>
          result.success,
      )
      .map((result) => result.data);
  }

  const result = await client.gmail.api.labels.list({});
  const rawLabels = (result.labels ?? []) as Array<Record<string, unknown>>;

  return rawLabels
    .map((l) => MailLabelSchema.safeParse(l))
    .filter(
      (result): result is { success: true; data: MailLabel } => result.success,
    )
    .map((result) => result.data);
}

const PROFILE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<string, { value: MailProfile; at: number }>();

export async function getProfile(): Promise<MailProfile | null> {
  const ctx = await getClient();
  if (!ctx) return null;
  const { tenantId, client } = ctx;

  const hit = profileCache.get(tenantId);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;

  const corsairApi = client.gmail.api as unknown as {
    usersGetProfile?: (opts: {}) => Promise<unknown>;
  };
  const raw = await corsairApi.usersGetProfile?.({});
  if (!raw) {
    return null;
  }

  const parsed = GetProfileApiResponseSchema.parse(raw);

  let name = "";
  let picture = "";
  try {
    const { getSession } = await import("@/server/better-auth/server");
    const session = await getSession();
    name = (session?.user as { name?: string })?.name ?? "";
    picture = (session?.user as { image?: string })?.image ?? "";
  } catch {
    // Fall back to email-derived name
  }

  const value: MailProfile = {
    emailAddress: parsed.emailAddress,
    messagesTotal: parsed.messagesTotal,
    threadsTotal: parsed.threadsTotal,
    historyId: parsed.historyId,
    cachedAt: new Date().toISOString(),
    name: name || parsed.emailAddress?.split("@")[0] || "",
    picture,
  };
  profileCache.set(tenantId, { value, at: Date.now() });
  return value;
}

export async function getMailPageData(
  opts: { force?: boolean; view?: string; page?: number } = {},
): Promise<MailPageData | null> {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;

  const plugins = await getConnectedCorsairPlugins(tenantId);
  const gmailConnected = plugins.includes("gmail");
  if (!gmailConnected) {
    return { tenantId, gmailConnected: false };
  }

  const view = opts.view ?? "INBOX";
  const page = Math.max(1, Math.floor(opts.page ?? 1));

  const labelDef = MAIL_LABELS.find((l) => l.id === view);
  let labelIds: string[] | undefined;
  let viewQuery: string | undefined;
  if (labelDef?.gmailQuery) {
    viewQuery = labelDef.gmailQuery;
    labelIds = undefined;
  } else if (labelDef?.gmailLabel) {
    labelIds = [labelDef.gmailLabel];
  } else {
    labelIds =
      view.startsWith("CATEGORY_") || view.startsWith("Label_")
        ? [view]
        : undefined;
  }

  // SSR uses the same PAGE_SIZE as the client. No more SSR_PAGE_SIZE.
  const [list, profile, labels] = await Promise.all([
    getMailList({
      page,
      labelIds,
      q: viewQuery,
    }),
    getProfile(),
    getLabels(),
  ]);

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}

// ─── Thread Actions (per-tenant cache invalidation) ──────────────────────
//
// Every mutation invalidates the calling tenant's mail-list cache so the
// next page load reflects the new state. Other tenants are untouched.

export async function archiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["INBOX"],
  });
}

export async function unarchiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["INBOX"],
  });
}

export async function trashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.trash({ id: threadId });
}

export async function untrashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.untrash({ id: threadId });
}

export async function starThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["STARRED"],
  });
}

export async function unstarThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["STARRED"],
  });
}

export async function markAsUnread(ids: string[]): Promise<void> {
  const ctx = await getClient();
  if (!ctx || ids.length === 0) return;
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.messages.batchModify({
    ids,
    addLabelIds: ["UNREAD"],
  });
}

export async function moveToSpam(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["SPAM"],
    removeLabelIds: ["INBOX"],
  });
}

export async function moveThreadToLabel(
  threadId: string,
  labelId: string,
): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: [labelId],
  });
}

export async function removeLabelFromThread(
  threadId: string,
  labelId: string,
): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: [labelId],
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);
  await ctx.client.gmail.api.threads.delete({ id: threadId });
}

// ─── Send / Reply / Forward ────────────────────────────────────────────────

import {
  buildEncodedMimeMessage,
  buildReplyMimeMessage,
  buildForwardMimeMessage,
  extractEmail,
  extractName,
  type MimeAttachment,
} from "./mime";

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

export async function sendEmail(
  params: SendEmailParams,
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const profile = await getProfile();
  const from = profile?.emailAddress;

  let raw: string;

  if (params.inReplyTo) {
    raw = buildReplyMimeMessage({
      from,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      text: params.text,
      inReplyTo: params.inReplyTo,
      references: params.references || params.inReplyTo,
      attachments: params.attachments,
    });
  } else {
    raw = buildEncodedMimeMessage({
      from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments,
    });
  }

  const result = await ctx.client.gmail.api.messages.send({
    raw,
    threadId: params.threadId,
  });

  return {
    id: (result as { id?: string }).id || "",
    threadId: (result as { threadId?: string }).threadId || params.threadId || "",
  };
}

export async function replyToMessage(
  messageId: string,
  body: string,
  options: { replyAll?: boolean; html?: boolean } = {},
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const original = await ctx.client.gmail.api.messages.get({
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID", "References", "Date"],
  });

  const payload = (original as { payload?: { headers?: Array<{ name?: string; value?: string }> } }).payload;
  const headers = payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  const originalFrom = getHeader("From");
  const originalTo = getHeader("To");
  const originalCc = getHeader("Cc");
  const originalSubject = getHeader("Subject");
  const originalMessageId = getHeader("Message-ID");
  const originalReferences = getHeader("References");
  const threadId = (original as { threadId?: string }).threadId || "";

  const profile = await getProfile();
  const myEmail = profile?.emailAddress?.toLowerCase() || "";
  const replyTo: string[] = [];

  if (originalFrom) {
    const senderEmail = extractEmail(originalFrom).toLowerCase();
    if (senderEmail !== myEmail) {
      replyTo.push(originalFrom);
    }
  }

  if (options.replyAll) {
    if (originalTo) {
      for (const addr of originalTo.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail && email !== extractEmail(originalFrom).toLowerCase()) {
          replyTo.push(addr.trim());
        }
      }
    }
    if (originalCc) {
      const ccRecipients: string[] = [];
      for (const addr of originalCc.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail) {
          ccRecipients.push(addr.trim());
        }
      }
      if (ccRecipients.length > 0) {
        const subject = originalSubject.startsWith("Re:")
          ? originalSubject
          : `Re: ${originalSubject}`;

        const references = originalReferences
          ? `${originalReferences} ${originalMessageId}`
          : originalMessageId;

        return sendEmail({
          to: replyTo,
          cc: ccRecipients,
          subject,
          html: options.html !== false ? body : undefined,
          text: options.html === false ? body : undefined,
          threadId,
          inReplyTo: originalMessageId,
          references,
        });
      }
    }
  }

  if (replyTo.length === 0 && originalFrom) {
    replyTo.push(originalFrom);
  }

  const subject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const references = originalReferences
    ? `${originalReferences} ${originalMessageId}`
    : originalMessageId;

  return sendEmail({
    to: replyTo,
    subject,
    html: options.html !== false ? body : undefined,
    text: options.html === false ? body : undefined,
    threadId,
    inReplyTo: originalMessageId,
    references,
  });
}

export async function forwardMessage(
  messageId: string,
  to: string[],
  body?: string,
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const original = await ctx.client.gmail.api.messages.get({
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
  });

  const payload = (original as { payload?: { headers?: Array<{ name?: string; value?: string }> } }).payload;
  const headers = payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  const originalFrom = getHeader("From");
  const originalTo = getHeader("To");
  const originalSubject = getHeader("Subject");
  const originalDate = getHeader("Date");
  const threadId = (original as { threadId?: string }).threadId || "";

  const profile = await getProfile();
  const from = profile?.emailAddress;

  const subject = originalSubject.startsWith("Fwd:")
    ? originalSubject
    : `Fwd: ${originalSubject}`;

  const raw = buildForwardMimeMessage({
    from,
    to,
    subject,
    html: body,
    text: body,
    originalFrom,
    originalDate,
    originalSubject,
    originalTo,
    originalBody: "",
  });

  const result = await ctx.client.gmail.api.messages.send({
    raw,
    threadId,
  });

  return {
    id: (result as { id?: string }).id || "",
    threadId: (result as { threadId?: string }).threadId || threadId || "",
  };
}

export type AttachmentResult =
  | { ok: true; data: string; size: number }
  | { ok: false; status: number; error: string; body?: string };

export async function getAttachmentContent(
  messageId: string,
  attachmentId: string,
): Promise<AttachmentResult> {
  const ctx = await getClient();
  if (!ctx) {
    return { ok: false, status: 401, error: "no_corsair_client" };
  }
  const { client } = ctx;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

  const fetchOnce = async (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    return { ok: false, status: 401, error: "no_access_token" };
  }

  let response = await fetchOnce(accessToken);

  if (response.status === 401) {
    const gmail = client.gmail as unknown as {
      _refreshAuth?: () => Promise<string>;
    };
    if (gmail._refreshAuth) {
      try {
        accessToken = await gmail._refreshAuth();
        response = await fetchOnce(accessToken);
      } catch {
        // fall through with the original 401
      }
    }
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {}
    console.warn(
      `[mail] attachment fetch failed: messageId=${messageId} attachmentId=${attachmentId} status=${response.status} body=${body.slice(0, 200)}`,
    );
    return {
      ok: false,
      status: response.status,
      body: body.slice(0, 500),
      error: `gmail_${response.status}`,
    };
  }

  const result = (await response.json()) as { data: string; size: number };
  return { ok: true, data: result.data, size: result.size };
}

export async function clearMailCache(): Promise<{
  deletedMessages: number;
  deletedLabels: number;
}> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const allMessages = await ctx.client.gmail.db.messages.list({ limit: 10000 });
  let deletedMessages = 0;
  for (const row of allMessages) {
    const entityId = row.data.id;
    if (typeof entityId === "string") {
      const ok = await ctx.client.gmail.db.messages.deleteByEntityId(entityId);
      if (ok) deletedMessages++;
    }
  }

  const allLabels = await ctx.client.gmail.db.labels.list();
  let deletedLabels = 0;
  for (const row of allLabels) {
    const entityId = row.data.id;
    if (typeof entityId === "string") {
      const ok = await ctx.client.gmail.db.labels.deleteByEntityId(entityId);
      if (ok) deletedLabels++;
    }
  }

  return { deletedMessages, deletedLabels };
}

export async function createDraft(params: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
}): Promise<{ id: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const profile = await getProfile();
  const from = profile?.emailAddress;
  const raw = buildEncodedMimeMessage({
    from,
    to: params.to ? params.to.split(",").map((e) => e.trim()).filter(Boolean) : [],
    cc: params.cc ? params.cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    bcc: params.bcc ? params.bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    subject: params.subject || "(No subject)",
    html: params.html || "",
  });
  const result = await ctx.client.gmail.api.drafts.create({
    draft: { message: { raw } },
  });
  return { id: (result as { id?: string }).id || "" };
}

export async function updateDraft(
  draftId: string,
  params: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    html?: string;
  },
): Promise<{ id: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const profile = await getProfile();
  const from = profile?.emailAddress;
  const raw = buildEncodedMimeMessage({
    from,
    to: params.to ? params.to.split(",").map((e) => e.trim()).filter(Boolean) : [],
    cc: params.cc ? params.cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    bcc: params.bcc ? params.bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    subject: params.subject || "(No subject)",
    html: params.html || "",
  });
  const result = await ctx.client.gmail.api.drafts.update({
    id: draftId,
    draft: { message: { raw } },
  });
  return { id: draftId, ...(result as object) };
}

export async function deleteDraft(draftId: string): Promise<{ ok: boolean }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.drafts.delete({ id: draftId });
  return { ok: true };
}
