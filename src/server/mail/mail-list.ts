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
  invalidateLabelCount,
} from "./label-count-cache";
import {
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
import { toListItem } from "./transformers";
import {
  isFilteredLabelView,
  classifyView,
  isRowEnriched,
  rowsToListItems,
  sortByReceivedDesc,
  buildPageMeta,
  emptyResponse,
  getMailListCacheKey,
  checkMailListCache,
  setMailListCache,
  invalidateMailListCacheForTenant,
  resolveCount,
} from "./mail-read-model";

const INBOX_LABEL = "INBOX";
const ENRICH_HEADERS = ["Subject", "From", "To", "Date"];

export { invalidateMailListCacheForTenant } from "./mail-read-model";

export async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

export function describeError(err: unknown): string {
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
  const cached = checkMailListCache(cacheKey);
  if (cached) return cached;

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

  setMailListCache(cacheKey, result);
  return result;
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
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

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
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

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
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

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

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}
