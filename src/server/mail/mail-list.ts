"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId, getAccountIdForTenant } from "@/server/connected-account";
import {
  countByLabel,
  listMessages,
  listByLabel,
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
import { enrichStubs, isRowEnriched, describeError } from "./_mail-helpers";

const INBOX_LABEL = "INBOX";

// ─── Response cache (per-tenant) ──────────────────────────────────────────

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

export async function invalidateMailListCacheForTenant(
  tenantId: string,
  view?: { labelIds?: string[]; query?: string },
): Promise<void> {
  const prefix = view
    ? `${tenantId}:${viewToken(view)}:`
    : `${tenantId}:`;
  for (const key of Array.from(mailListCache.keys())) {
    if (key.startsWith(prefix)) mailListCache.delete(key);
  }
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

type ViewKind = "label" | "query" | "search";

function classifyView(view: {
  labelIds?: string[];
  query?: string;
}): ViewKind {
  if (view.query) return view.labelIds?.length ? "label" : "search";
  return "label";
}

function isFilteredLabelView(labelIds: string[] | undefined): boolean {
  if (!labelIds || labelIds.length === 0) return false;
  return labelIds.length > 1 || labelIds[0] !== INBOX_LABEL;
}

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
    } catch (err) {
      console.log(`[mail-debug] resolveCount: DB labels.list failed: ${describeError(err)}`);
    }

    try {
      const cachedTotal = await getCachedLabelCount(accountId, labelId, async () => {
        const label = await client.gmail.api.labels.get({ id: labelId });
        const apiTotal = (label as Record<string, unknown>).messagesTotal as
          | number
          | undefined;
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

// ─── Read paths ─────────────────────────────────────────────────────────

async function getMailListFromSearch(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  q: string,
  page: number,
  _labelIds: string[],
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
    await syncLabelFromGmail(accountId, client, syncDepth, view.labelIds, view.query);
    rows = await listByLabel(accountId, labelIds, { limit: PAGE_SIZE, offset });
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
    await syncLabelFromGmail(accountId, client, syncDepth, view.labelIds, view.query);
    rows = await listMessages(accountId, { limit: PAGE_SIZE, offset });
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

// ─── Public API ──────────────────────────────────────────────────────────

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

// ─── Profile ──────────────────────────────────────────────────────────────

const LABEL_COUNT_TTL_MS = 5 * 60 * 1000;

async function refreshLabelCount(
  client: ReturnType<typeof corsair.withTenant>,
  labelId: string,
): Promise<boolean> {
  try {
    const label = (await client.gmail.api.labels.get({ id: labelId })) as
      | Record<string, unknown>
      | null;
    const labelIdFromResult = label?.id;
    if (typeof labelIdFromResult !== "string") return false;
    await client.gmail.db.labels.upsertByEntityId(labelIdFromResult, {
      ...label,
      id: labelIdFromResult,
      createdAt: new Date(),
    });
    return true;
  } catch (err) {
    console.log(
      `[mail-debug] getLabels: labels.get(${labelId}) failed: ${describeError(err)}`,
    );
    return false;
  }
}

export async function getLabels(): Promise<MailLabel[]> {
  const ctx = await getClient();
  if (!ctx) return [];
  const { client } = ctx;

  let cached = await client.gmail.db.labels.list();

  const now = Date.now();
  const systemLabelIds = MAIL_LABELS.flatMap((def) =>
    def.gmailLabel ? [def.gmailLabel] : [],
  );
  const idsNeedingRefresh = new Set<string>();

  for (const id of systemLabelIds) {
    const row = cached.find(
      (r) => (r.data as Record<string, unknown>)?.id === id,
    );
    if (!row) {
      idsNeedingRefresh.add(id);
      continue;
    }
    const total = (row.data as Record<string, unknown>)?.messagesTotal;
    const rawUpdated = (row as { updated_at?: Date | string }).updated_at;
    const updated =
      rawUpdated instanceof Date
        ? rawUpdated.getTime()
        : typeof rawUpdated === "string"
          ? Date.parse(rawUpdated)
          : null;
    if (typeof total !== "number" || updated === null || now - updated > LABEL_COUNT_TTL_MS) {
      idsNeedingRefresh.add(id);
    }
  }

  if (idsNeedingRefresh.size > 0) {
    const results = await Promise.allSettled(
      Array.from(idsNeedingRefresh).map((id) => refreshLabelCount(client, id)),
    );
    const refreshed = results.filter((r) => r.status === "fulfilled" && r.value).length;
    console.log(
      `[mail-debug] getLabels: refreshed ${refreshed}/${idsNeedingRefresh.size} labels via labels.get`,
    );
    cached = await client.gmail.db.labels.list();
  }

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
      (result): result is { success: true; data: MailLabel } =>
        result.success,
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

  const { GetProfileApiResponseSchema } = await import("./schemas");
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
