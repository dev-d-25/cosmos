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
import {
  getLabelCount as getCachedLabelCount,
  invalidateLabelCount,
} from "./label-count-cache";
import { toListItem } from "./transformers";
import {
  MailLabelSchema,
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

export async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
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

type ViewKind = "label" | "query" | "search";

function classifyView(view: {
  labelIds?: string[];
  query?: string;
}): ViewKind {
  if (view.query) return view.labelIds?.length ? "label" : "search";
  return "label";
}

async function resolveCount(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
): Promise<{ count: number | null; degraded: boolean }> {
  if (classifyView(view) === "search") {
    console.log(`[mail-debug] resolveCount: search view → count=null`);
    return { count: null, degraded: false };
  }

  if (view.labelIds?.length === 1) {
    const labelId = view.labelIds[0];
    if (!labelId) {
      const dbCount = await countByLabel(accountId, view.labelIds);
      console.log(`[mail-debug] resolveCount: empty labelId → dbCount=${dbCount}`);
      return { count: dbCount, degraded: false };
    }
    try {
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
        console.log(
          `[mail-debug] resolveCount: DB cache hit for ${labelId} → ${labelTotal}`,
        );
        return { count: labelTotal, degraded: false };
      }
      console.log(
        `[mail-debug] resolveCount: DB row for ${labelId} missing messagesTotal, falling back to labels.get`,
      );
    } catch (err) {
      console.log(`[mail-debug] resolveCount: DB labels.list failed: ${describeError(err)}`);
    }

    try {
      const cachedTotal = await getCachedLabelCount(accountId, labelId, async () => {
        const label = await client.gmail.api.labels.get({ id: labelId });
        const apiTotal = (label as Record<string, unknown>).messagesTotal as
          | number
          | undefined;
        const apiUnread = (label as Record<string, unknown>).messagesUnread as
          | number
          | undefined;
        console.log(
          `[mail-debug] resolveCount: labels.get(${labelId}) → total=${apiTotal} unread=${apiUnread}`,
        );
        return typeof apiTotal === "number" && apiTotal >= 0 ? apiTotal : null;
      });
      if (typeof cachedTotal === "number") {
        return { count: cachedTotal, degraded: false };
      }
    } catch (err) {
      console.log(`[mail-debug] resolveCount: labels.get(${labelId}) failed: ${describeError(err)}`);
    }
  }

  const dbCount = view.labelIds?.length
    ? await countByLabel(accountId, view.labelIds)
    : await client.gmail.db.messages.count();
  console.log(`[mail-debug] resolveCount: dbCount fallback = ${dbCount}`);
  return { count: dbCount, degraded: false };
}

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

export interface GetMailListOpts {
  page?: number;
  labelIds?: string[];
  q?: string;
  pageToken?: string | null;
}

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

  const rawPage = opts.page ?? 1;
  const finitePage = Number.isFinite(rawPage) ? rawPage : 1;
  const requestedPage = Math.max(1, Math.floor(finitePage));

  const cacheKey = getMailListCacheKey(tenantId, view, requestedPage);
  const cached = mailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
    return cached.data;
  }

  console.log(
    `[mail-debug] getMailList view=${JSON.stringify(view)} page=${requestedPage} → isSearch=${isSearchView} isFiltered=${isFilteredLabel} isQuery=${isQueryView}`,
  );

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

  if (rows.length === 0 && offset > 0) {
    const syncDepth = offset + PAGE_SIZE;
    console.log(
      `[mail-debug] getMailListFromFilteredView: DB miss at offset=${offset}, deep-jump sync to depth=${syncDepth} for labelIds=${JSON.stringify(labelIds)} query=${view.query ?? "—"}`,
    );
    await syncLabelFromGmail(
      accountId,
      client,
      syncDepth,
      view.labelIds,
      view.query,
    );
    rows = await listByLabel(accountId, labelIds, { limit: PAGE_SIZE, offset });
    console.log(
      `[mail-debug] getMailListFromFilteredView: after deep-jump, rows=${rows.length}`,
    );
  }

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

  if (pageToken) {
    return getMailListFromGmailToken(accountId, client, view, page, pageToken);
  }

  let rows = await listMessages(accountId, {
    limit: PAGE_SIZE,
    offset,
  });

  if (rows.length === 0 && offset > 0) {
    const syncDepth = offset + PAGE_SIZE;
    console.log(
      `[mail-debug] getMailListFromInbox: DB miss at offset=${offset}, deep-jump sync to depth=${syncDepth}`,
    );
    await syncLabelFromGmail(
      accountId,
      client,
      syncDepth,
      view.labelIds,
      view.query,
    );
    rows = await listMessages(accountId, { limit: PAGE_SIZE, offset });
    console.log(
      `[mail-debug] getMailListFromInbox: after deep-jump, rows=${rows.length}`,
    );
  }

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
    console.log(
      `[mail-debug] syncLabelFromGmail limit=${limit} labelIds=${JSON.stringify(labelIds)} q=${q ?? "—"} → fetched=${((listResult.messages ?? []) as unknown[]).length} estimate=${listResult.resultSizeEstimate ?? "null"}`,
    );
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

export async function refreshInbox(
  viewId: string = "INBOX",
  page: number = 1,
): Promise<{ synced: number }> {
  const ctx = await getClient();
  if (!ctx) return { synced: 0 };
  const { tenantId, accountId, client } = ctx;

  invalidateMailListCacheForTenant(tenantId);

  const viewDef = MAIL_LABELS.find((l) => l.id === viewId) ?? MAIL_LABELS[0];
  let labelIds: string[] | undefined;
  let viewQuery: string | undefined;
  if (viewDef?.gmailQuery) {
    viewQuery = viewDef.gmailQuery;
    labelIds = undefined;
  } else if (viewDef?.gmailLabel) {
    labelIds = [viewDef.gmailLabel];
  } else {
    labelIds = [INBOX_LABEL];
  }

  const requestedPage = Math.max(1, Math.floor(page));
  const syncDepth = Math.max(PAGE_SIZE, (requestedPage - 1) * PAGE_SIZE + PAGE_SIZE);

  console.log(
    `[mail-debug] refreshInbox: view=${viewId} page=${requestedPage} syncing labelIds=${JSON.stringify(labelIds)} query=${viewQuery ?? "—"} depth=${syncDepth}`,
  );

  if (labelIds) {
    for (const labelId of labelIds) {
      invalidateLabelCount(accountId, labelId);
    }
  }

  const syncResult = await syncLabelFromGmail(
    accountId, client, syncDepth, labelIds, viewQuery,
  );

  try {
    await client.gmail.api.labels.list({});
  } catch (err) {
    console.log(`[mail] refreshInbox: labels.list failed: ${describeError(err)}`);
  }

  invalidateMailListCacheForTenant(tenantId);

  return { synced: syncResult.fetched };
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

  console.log(
    `[mail-debug] getMailPageData view=${view} page=${page} → labelIds=${JSON.stringify(labelIds)} query=${viewQuery ?? "—"}`,
  );

  const { getProfile, getLabels } = await import("./mail-profile");

  const [list, profile, labels] = await Promise.all([
    getMailList({
      page,
      labelIds,
      q: viewQuery,
    }),
    getProfile(),
    getLabels(),
  ]);

  console.log(
    `[mail-debug] getMailPageData result: count=${list.count ?? "null"} items=${list.items.length} cacheState=${list.cacheState} coverage=${list.coverage.toFixed(2)} totalPages=${list.totalPages ?? "null"}`,
  );

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}
