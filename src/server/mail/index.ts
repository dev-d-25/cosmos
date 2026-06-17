"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
import {
  countByLabel,
  getAccountIdForTenant,
  listByLabel,
  upsertManyByEntityIds,
  type RawMessageEntity,
  type UpsertItem,
} from "@/server/db/mail-entities";
import { toListItem } from "./transformers";
import {
  InboxRefreshResponseSchema,
  GetProfileApiResponseSchema,
  MailLabelSchema,
  MailListItemSchema,
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
const DEFAULT_PAGE_SIZE = 50;
const ENRICH_CONCURRENCY = 10;
const CACHE_PAGE_TOKEN_PREFIX = "cache:";
const FILTERED_LABEL_CACHE_FETCH_MULTIPLIER = 10;
const FILTERED_LABEL_CACHE_FETCH_CAP = 1000;

// ─── Response cache (Phase 5) ──────────────────────────────────────────────
const mailListCache = new Map<string, { data: MailListResponse; at: number }>();
const MAIL_LIST_CACHE_TTL = 30_000;

function getMailListCacheKey(opts: Record<string, unknown>): string {
  return JSON.stringify({
    pageIndex: opts.pageIndex ?? 0,
    pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE,
    pageToken: opts.pageToken ?? null,
    labelIds: opts.labelIds ?? null,
    q: opts.q ?? null,
    // `force` is intentionally NOT part of the key — callers must call
    // invalidateMailListCache() or simply skip the cache for force=true.
  });
}

function invalidateMailListCache(): void {
  mailListCache.clear();
}

function isRowEnriched(row: { data: Record<string, unknown> }): boolean {
  const d = row.data;
  if (d.from || d.subject) return true;
  const payload = d.payload as
    | { headers?: Array<{ name?: string; value?: string }> }
    | undefined;
  const headers = payload?.headers;
  if (Array.isArray(headers)) {
    const hasFrom = headers.some(
      (h) => h.name?.toLowerCase() === "from" && h.value,
    );
    const hasSubject = headers.some(
      (h) => h.name?.toLowerCase() === "subject" && h.value,
    );
    if (hasFrom || hasSubject) return true;
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

  // ── Batch check which IDs need enrichment (1 query instead of N) ──
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

  const ENRICH_HEADERS = ["Subject", "From", "To", "Date"];
  let succeeded = 0;
  let failed = 0;

  const chunks: string[][] = [];
  for (let i = 0; i < needsEnrichment.length; i += ENRICH_CONCURRENCY) {
    chunks.push(needsEnrichment.slice(i, i + ENRICH_CONCURRENCY));
  }

  // Get an access token once for all requests (it's valid for ~1 hour).
  const accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    console.log(
      `[mail] Enriched 0/${ids.length} — no access token available; ${needsEnrichment.length} stubs will remain unenriched`,
    );
    return;
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (id) => {
        // ── Direct fetch to Gmail REST API ──
        // The SDK's messages.get endpoint joins metadataHeaders into a single
        // comma-separated param, but Gmail requires *repeated* params:
        //   metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To
        // The comma-joined form is silently ignored → no headers returned.
        // This direct call uses the correct format.
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&${ENRICH_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&")}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
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
      }
    });

    // ── Bulk persist successful results (1 query per chunk, ON CONFLICT) ──
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
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[mail] Enriched ${needsEnrichment.length}/${ids.length} | succeeded=${succeeded} failed=${failed} in ${elapsed}ms`,
  );
}

function isCachePageToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith(CACHE_PAGE_TOKEN_PREFIX);
}

function makeCachePageToken(pageIndex: number): string {
  return `${CACHE_PAGE_TOKEN_PREFIX}${pageIndex}`;
}

function parseCachePageToken(token: string | null | undefined): number | null {
  if (typeof token !== "string" || !token.startsWith(CACHE_PAGE_TOKEN_PREFIX))
    return null;
  const parsed = Number(token.slice(CACHE_PAGE_TOKEN_PREFIX.length));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
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

function filterByLabel<T extends { data: Record<string, unknown> }>(
  rows: T[],
  labelIds: string[],
): T[] {
  return rows.filter((r) => {
    const rowLabels = (r.data.labelIds as string[] | undefined) ?? [];
    return labelIds.every((label) => rowLabels.includes(label));
  });
}

/**
 * Fetch message IDs from Gmail for the given label, then enrich every one
 * with format:"metadata" (From, Subject, Date headers — no body).
 * This is the middle ground: fast enough for bulk, gives us everything
 * needed for the list view.
 */
async function syncLabelFromGmail(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  limit: number,
  labelIds?: string[],
  q?: string,
): Promise<{ nextPageToken: string | null; resultSizeEstimate: number | null }> {
  const t0 = Date.now();
  const listResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: limit,
    ...(labelIds?.length ? { labelIds } : {}),
    ...(q ? { q, includeSpamTrash: true } : {}),
  });

  const ids = (listResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  console.log(
    `[mail] syncLabelFromGmail: got ${ids.length} IDs from Gmail in ${Date.now() - t0}ms (resultSizeEstimate=${listResult.resultSizeEstimate ?? "n/a"})`,
  );

  const resultSizeEstimate = listResult.resultSizeEstimate ?? null;

  if (ids.length === 0) {
    return { nextPageToken: null, resultSizeEstimate };
  }

  await enrichStubs(accountId, client, ids);

  return {
    nextPageToken:
      ids.length >= limit ? (listResult.nextPageToken ?? null) : null,
    resultSizeEstimate,
  };
}

export async function getMailList(
  opts: {
    pageIndex?: number;
    pageSize?: number;
    pageToken?: string | null;
    force?: boolean;
    labelIds?: string[];
    q?: string;
  } = {},
): Promise<MailListResponse> {
  const ctx = await getClient();
  if (!ctx) return { items: [], nextPageToken: null, source: "cache", totalCount: 0 };
  const { tenantId, accountId, client } = ctx;

  const isQueryMode = !!opts.q;
  const labelIds = opts.labelIds ?? (isQueryMode ? [] : [INBOX_LABEL]);
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const cacheTokenPage = parseCachePageToken(opts.pageToken);
  const hasGmailToken =
    typeof opts.pageToken === "string" &&
    opts.pageToken.length > 0 &&
    !isCachePageToken(opts.pageToken);
  const isFilteredLabel =
    labelIds.length > 0 && labelIds[0] !== INBOX_LABEL;

  // ── Response cache (Phase 5) — force=true bypasses cache ──
  if (!opts.force && !hasGmailToken) {
    const cacheKey = `${tenantId}:${getMailListCacheKey(opts as Record<string, unknown>)}`;
    const cached = mailListCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
      return cached.data;
    }
  }

  let result: MailListResponse;
  if (isQueryMode && !cacheTokenPage) {
    result = await getMailListFromQuery(accountId, client, opts, pageSize, labelIds);
  } else if (cacheTokenPage !== null) {
    result = await getMailListFromCachePage(accountId, client, cacheTokenPage, pageSize, labelIds, isFilteredLabel);
  } else {
    result = await getMailListFromNormal(accountId, client, opts, pageSize, labelIds, hasGmailToken, isFilteredLabel);
  }

  // Cache the result (skipped for force=true and Gmail-token pages)
  if (!opts.force && !hasGmailToken) {
    const cacheKey = `${tenantId}:${getMailListCacheKey(opts as Record<string, unknown>)}`;
    mailListCache.set(cacheKey, { data: result, at: Date.now() });
  }

  return result;
}

async function getMailListFromQuery(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  opts: { pageToken?: string | null; q?: string },
  pageSize: number,
  labelIds: string[],
): Promise<MailListResponse> {
  const apiResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: pageSize,
    pageToken: opts.pageToken ?? undefined,
    q: opts.q!,
    includeSpamTrash: true,
  });

  const ids = (apiResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) {
    return { items: [], nextPageToken: null, source: "live", totalCount: 0 };
  }

  await enrichStubs(accountId, client, ids);

  // Batch read all enriched rows in a single query (was: N+1)
  const existingRows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const rowByEntityId = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    rowByEntityId.set(row.data.id, row);
  }

  const items: MailListItem[] = [];
  for (const id of ids) {
    const row = rowByEntityId.get(id);
    if (row) {
      const item = toListItem(row);
      if (item.id) items.push(item);
    }
  }

  return {
    items,
    nextPageToken: apiResult.nextPageToken ?? null,
    source: "live",
    totalCount: apiResult.resultSizeEstimate ?? 0,
  };
}

async function getMailListFromCachePage(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  cacheTokenPage: number,
  pageSize: number,
  labelIds: string[],
  isFilteredLabel: boolean,
): Promise<MailListResponse> {
  const offset = cacheTokenPage * pageSize;

  // ── Filtered labels: SQL-level filter using GIN index (no progressive loading) ──
  if (isFilteredLabel) {
    let rows = await listByLabel(accountId, labelIds, {
      limit: pageSize,
      offset,
    });

    if (rows.length === 0) {
      return { items: [], nextPageToken: null, source: "cache", totalCount: 0 };
    }

    // Enrich any stubs in this page
    const stubIds = rows
      .filter((r) => !isRowEnriched(r))
      .map((r) => r.data.id)
      .filter((id): id is string => !!id);

    if (stubIds.length > 0) {
      await enrichStubs(accountId, client, stubIds);
      rows = await listByLabel(accountId, labelIds, { limit: pageSize, offset });
    }

    const enriched = rows.filter(isRowEnriched);
    const items = sortByReceivedDesc(rowsToListItems(enriched));
    const totalCount = await countByLabel(accountId, labelIds);
    const hasMore = totalCount > offset + pageSize;

    return {
      items,
      nextPageToken: hasMore ? makeCachePageToken(cacheTokenPage + 1) : null,
      source: "cache",
      totalCount,
    };
  }

  // ── INBOX / unfiltered: legacy path with corrected totalCount ──
  const limit = (cacheTokenPage + 1) * pageSize;
  let cachedAll = await client.gmail.db.messages.list({
    limit,
    offset: 0,
  });
  if (cachedAll.length === 0) {
    return { items: [], nextPageToken: null, source: "cache", totalCount: 0 };
  }

  // Enrich any stubs
  const stubIds = cachedAll
    .filter((r) => !isRowEnriched(r))
    .map((r) => (r.data as Record<string, unknown>).id as string)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    cachedAll = await client.gmail.db.messages.list({ limit, offset: 0 });
  }

  const enriched = cachedAll.filter(isRowEnriched);
  const page = sortByReceivedDesc(rowsToListItems(enriched)).slice(
    offset,
    offset + pageSize,
  );

  // Use DB totalCount (accurate for unfiltered — DB stores all messages for
  // this account, regardless of label).
  const totalCount = await client.gmail.db.messages.count();

  const hasMore = enriched.length > offset + pageSize;
  return {
    items: page,
    nextPageToken: hasMore ? makeCachePageToken(cacheTokenPage + 1) : null,
    source: "cache",
    totalCount,
  };
}

async function getMailListFromNormal(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  opts: { pageIndex?: number; pageToken?: string | null; force?: boolean; q?: string },
  pageSize: number,
  labelIds: string[],
  hasGmailToken: boolean,
  isFilteredLabel: boolean,
): Promise<MailListResponse> {
  const pageIndex = Math.max(0, Math.floor(opts.pageIndex ?? 0));
  const offset = pageIndex * pageSize;
  const totalNeeded = offset + pageSize;

  // ── Page 0 ────────────────────────────────────────────────────────
  if (pageIndex === 0) {
    // ── FORCE: bypass cache, always sync from Gmail ──
    if (opts.force) {
      console.log(`[mail] Page 0: force=true, syncing from Gmail`);
      invalidateMailListCache();
      const t0 = Date.now();
      const { nextPageToken, resultSizeEstimate } = await syncLabelFromGmail(
        accountId, client, totalNeeded, labelIds, opts.q,
      );
      let nextToken = nextPageToken;
      if (!nextToken && !isFilteredLabel) {
        const total =
          resultSizeEstimate != null && resultSizeEstimate > 0
            ? resultSizeEstimate
            : await client.gmail.db.messages.count();
        if (total > (pageIndex + 1) * pageSize) {
          nextToken = makeCachePageToken(pageIndex + 1);
        }
      }
      console.log(`[mail] Page 0 force-sync done in ${Date.now() - t0}ms`);
      return buildPageFromDB(
        accountId, client,
        offset, pageSize, totalNeeded,
        isFilteredLabel, labelIds, nextToken, "live", resultSizeEstimate,
      );
    }

    // ── FAST PATH: try cache first ──
    // For unfiltered INBOX: read first pageSize rows.
    // For filtered labels: oversample by FILTERED_LABEL_CACHE_FETCH_MULTIPLIER
    //   (capped) so we can find label-matching items beyond the first page.
    const cacheFetchLimit = isFilteredLabel
      ? Math.min(pageSize * FILTERED_LABEL_CACHE_FETCH_MULTIPLIER, FILTERED_LABEL_CACHE_FETCH_CAP)
      : pageSize;

    const cachedAll = await client.gmail.db.messages.list({
      limit: cacheFetchLimit,
      offset: 0,
    });

    const cachedFiltered = isFilteredLabel
      ? filterByLabel(cachedAll, labelIds)
      : cachedAll;
    const enrichedCount = cachedFiltered.filter(isRowEnriched).length;

    if (enrichedCount >= pageSize) {
      console.log(
        `[mail] Page 0: cache hit (${enrichedCount} enriched / ${pageSize} needed, skipping Gmail sync)`,
      );
      // Pass null nextToken — buildPageFromDB will emit cache:N only when
      // it actually finds more rows than the current page.
      return buildPageFromDB(
        accountId, client,
        0, pageSize, pageSize,
        isFilteredLabel, labelIds,
        null, "cache", null,
      );
    }

    // ── Background sync option (Phase 8): for INBOX only ──
    // If we have SOME data but not enough, return what we have and sync
    // in the background. Trade-off: user sees partial list immediately,
    // list grows as sync completes. Disabled for filtered/search.
    if (
      enrichedCount > 0 &&
      !isFilteredLabel &&
      !opts.q
    ) {
      console.log(
        `[mail] Page 0: partial cache (${enrichedCount}/${pageSize}), returning partial + background sync`,
      );
      const partial = await buildPageFromDB(
        accountId, client,
        0, enrichedCount, pageSize,
        false, labelIds, null, "cache", null,
      );
      // Fire-and-forget background sync
      void backgroundSync(accountId, client, labelIds, pageSize * 2, opts.q);
      return partial;
    }

    // ── SLOW PATH: need to sync from Gmail ──
    console.log(
      `[mail] Page 0: cache miss (${enrichedCount}/${pageSize} enriched, syncing from Gmail)`,
    );
    const t0 = Date.now();
    const { nextPageToken, resultSizeEstimate } = await syncLabelFromGmail(
      accountId, client, totalNeeded, labelIds, opts.q,
    );
    let nextToken = nextPageToken;
    if (!nextToken && !isFilteredLabel) {
      const total =
        resultSizeEstimate != null && resultSizeEstimate > 0
          ? resultSizeEstimate
          : await client.gmail.db.messages.count();
      if (total > (pageIndex + 1) * pageSize) {
        nextToken = makeCachePageToken(pageIndex + 1);
      }
    }
    console.log(`[mail] Page 0 sync done in ${Date.now() - t0}ms`);
    return buildPageFromDB(
      accountId, client,
      offset, pageSize, totalNeeded,
      isFilteredLabel, labelIds, nextToken, "live", resultSizeEstimate,
    );
  }

  // ── Page 1+: try cache first, enrich any stubs before returning ────
  if (!hasGmailToken) {
    // For filtered labels, use SQL-level pagination via the GIN index
    if (isFilteredLabel) {
      let rows = await listByLabel(accountId, labelIds, {
        limit: pageSize,
        offset,
      });

      if (rows.length > 0) {
        const stubIds = rows
          .filter((r) => !isRowEnriched(r))
          .map((r) => r.data.id)
          .filter((id): id is string => !!id);

        if (stubIds.length > 0) {
          await enrichStubs(accountId, client, stubIds);
          rows = await listByLabel(accountId, labelIds, { limit: pageSize, offset });
        }

        const enriched = rows.filter(isRowEnriched);
        const items = sortByReceivedDesc(rowsToListItems(enriched));
        const totalCount = await countByLabel(accountId, labelIds);
        const hasMore = totalCount > offset + pageSize;

        return {
          items,
          nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
          source: "cache",
          totalCount,
        };
      }

      return { items: [], nextPageToken: null, source: "cache", totalCount: 0 };
    }

    // For INBOX (unfiltered), legacy cache path
    const cacheLoadLimit = totalNeeded;
    const cachedAll = await client.gmail.db.messages.list({
      limit: cacheLoadLimit,
      offset: 0,
    });

    if (cachedAll.length > 0) {
      const stubIds = cachedAll
        .filter((r) => !isRowEnriched(r))
        .map((r) => (r.data as Record<string, unknown>).id as string)
        .filter((id): id is string => !!id);

      if (stubIds.length > 0) {
        await enrichStubs(accountId, client, stubIds);
        const refreshedAll = await client.gmail.db.messages.list({
          limit: cacheLoadLimit,
          offset: 0,
        });
        const page = sortByReceivedDesc(rowsToListItems(refreshedAll)).slice(
          offset,
          offset + pageSize,
        );
        const totalCount = await client.gmail.db.messages.count();
        const hasMore = refreshedAll.length > (pageIndex + 1) * pageSize;
        return {
          items: page,
          nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
          source: "cache",
          totalCount,
        };
      }

      const page = sortByReceivedDesc(rowsToListItems(cachedAll)).slice(
        offset,
        offset + pageSize,
      );
      const totalCount = await client.gmail.db.messages.count();
      const hasMore = cachedAll.length > (pageIndex + 1) * pageSize;
      return {
        items: page,
        nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
        source: "cache",
        totalCount,
      };
    }

    return { items: [], nextPageToken: null, source: "cache", totalCount: 0 };
  }

  // ── Has Gmail token: fetch next page from API ────
  const apiResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: pageSize,
    pageToken: opts.pageToken!,
    ...(opts.q ? { q: opts.q, includeSpamTrash: true } : { labelIds }),
  });
  const nextToken = apiResult.nextPageToken ?? null;
  const resultSizeEstimate = apiResult.resultSizeEstimate ?? null;

  const ids = (apiResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length > 0) {
    await enrichStubs(accountId, client, ids);
  }

  return buildPageFromDB(
    accountId, client,
    offset, pageSize, totalNeeded,
    isFilteredLabel, labelIds, nextToken, "live", resultSizeEstimate,
  );
}

/**
 * Fire-and-forget background sync for the partial-cache path (Phase 8).
 * Errors are logged but never propagated to the caller (which has already
 * returned partial data).
 */
async function backgroundSync(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  labelIds: string[] | undefined,
  limit: number,
  q: string | undefined,
): Promise<void> {
  try {
    invalidateMailListCache();
    const result = await syncLabelFromGmail(accountId, client, limit, labelIds, q);
    console.log(
      `[mail] background sync done: nextPageToken=${result.nextPageToken ?? "null"} resultSizeEstimate=${result.resultSizeEstimate}`,
    );
    invalidateMailListCache();
  } catch (err) {
    console.log(`[mail] background sync failed: ${describeError(err)}`);
  }
}

async function buildPageFromDB(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  offset: number,
  pageSize: number,
  totalNeeded: number,
  isFilteredLabel: boolean,
  labelIds: string[],
  nextToken: string | null,
  source: "cache" | "live",
  resultSizeEstimate?: number | null,
): Promise<MailListResponse> {
  // ── Filtered labels: SQL-level filter using GIN index ──
  if (isFilteredLabel) {
    let rows = await listByLabel(accountId, labelIds, {
      limit: pageSize,
      offset,
    });

    // Self-healing: enrich stubs found in this page
    const stubIds = rows
      .filter((r) => !isRowEnriched(r))
      .map((r) => r.data.id)
      .filter((id): id is string => !!id);

    if (stubIds.length > 0) {
      await enrichStubs(accountId, client, stubIds);
      console.log(
        `[mail] buildPageFromDB (filtered): enriched ${stubIds.length} stubs, re-reading`,
      );
      rows = await listByLabel(accountId, labelIds, { limit: pageSize, offset });
    }

    const enriched = rows.filter(isRowEnriched);
    const items = sortByReceivedDesc(rowsToListItems(enriched));
    const totalCount = await countByLabel(accountId, labelIds);
    const hasMore = totalCount > offset + pageSize || nextToken !== null;

    console.log(
      `[mail] buildPageFromDB (filtered): pageItems=${items.length} totalCount=${totalCount}`,
    );
    return {
      items,
      nextPageToken: hasMore
        ? (nextToken ?? makeCachePageToken(Math.floor(offset / pageSize) + 1))
        : null,
      source,
      totalCount,
    };
  }

  // ── Unfiltered INBOX: legacy path with corrected totalCount ──
  const fetchLimit = totalNeeded;
  let rows = await client.gmail.db.messages.list({
    limit: fetchLimit,
    offset: 0,
  });

  // Self-healing: if rows contain unenriched stubs, enrich them and re-read
  const stubIds = rows
    .filter((r) => !isRowEnriched(r))
    .map((r) => (r.data as Record<string, unknown>).id as string)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    console.log(
      `[mail] buildPageFromDB: enriched ${stubIds.length} stubs, re-reading`,
    );
    rows = await client.gmail.db.messages.list({
      limit: fetchLimit,
      offset: 0,
    });
  }

  const enriched = rows.filter(isRowEnriched);

  console.log(`[mail] buildPageFromDB: totalRows=${rows.length} enriched=${enriched.length} fetchLimit=${fetchLimit} resultSizeEstimate=${resultSizeEstimate ?? "n/a"}`);

  const page = sortByReceivedDesc(rowsToListItems(enriched)).slice(
    offset,
    offset + pageSize,
  );

  // totalCount priority:
  //   1. resultSizeEstimate from Gmail API (most accurate, live count)
  //   2. Label.messagesTotal from DB for single-label views (cached exact count)
  //   3. DB total count
  let totalCount: number;
  if (resultSizeEstimate != null && resultSizeEstimate > 0) {
    totalCount = resultSizeEstimate;
  } else if (labelIds.length === 1) {
    const cachedLabels = await client.gmail.db.labels.list();
    const matchingLabel = cachedLabels.find(
      (l) => (l.data as Record<string, unknown>).id === labelIds[0],
    );
    const labelTotal = matchingLabel
      ? ((matchingLabel.data as Record<string, unknown>).messagesTotal as
          | number
          | undefined)
      : undefined;
    totalCount = labelTotal ?? (await client.gmail.db.messages.count());
  } else {
    totalCount = await client.gmail.db.messages.count();
  }

  // hasMore: true if either (a) the loaded page has more rows than fits,
  // (b) we already have a Gmail-side nextToken, or (c) totalCount exceeds
  // what was loaded into this page.
  const pageHasMore = enriched.length > offset + pageSize;
  const moreInDb = totalCount > page.length + offset;
  const hasMore = pageHasMore || moreInDb || nextToken !== null;

  console.log(`[mail] buildPageFromDB: returning ${page.length} items, totalCount=${totalCount}, hasMore=${hasMore}`);
  return {
    items: page,
    nextPageToken: hasMore ? (nextToken ?? makeCachePageToken(Math.floor(offset / pageSize) + 1)) : null,
    source,
    totalCount,
  };
}

export async function getMessage(
  id: string,
  opts: { force?: boolean } = {},
): Promise<{
  message: Record<string, unknown>;
  source: "cache" | "live";
} | null> {
  const ctx = await getClient();
  if (!ctx) return null;
  const { client } = ctx;

  if (!opts.force) {
    const cached = await client.gmail.db.messages.findByEntityId(id);
    if (cached?.data?.payload) {
      // Verify the cached payload actually has body data (not just metadata headers).
      // Messages enriched with format:"metadata" have payload.headers but no body.
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

  const full = (await client.gmail.api.messages.get({
    id,
    format: "full",
  })) as Record<string, unknown>;

  return { message: full, source: "live" };
}

export async function refreshInbox(): Promise<{ synced: number }> {
  const ctx = await getClient();
  if (!ctx) return { synced: 0 };
  // refreshInbox is an explicit user-initiated sync — always bypass cache.
  invalidateMailListCache();
  const inboxDef = MAIL_LABELS.find((l) => l.id === "INBOX");
  if (inboxDef?.gmailQuery) {
    await syncLabelFromGmail(ctx.accountId, ctx.client, DEFAULT_PAGE_SIZE, undefined, inboxDef.gmailQuery);
  } else {
    await syncLabelFromGmail(ctx.accountId, ctx.client, DEFAULT_PAGE_SIZE, [INBOX_LABEL]);
  }
  invalidateMailListCache();
  const rows = await ctx.client.gmail.db.messages.list({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
  });
  return { synced: rows.length };
}

export async function markAsRead(
  ids: string[],
): Promise<{ marked: number }> {
  const ctx = await getClient();
  if (!ctx || ids.length === 0) return { marked: 0 };

  const { client } = ctx;
  invalidateMailListCache();
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

  // Fetch user name and picture from session
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
  opts: { force?: boolean; view?: string } = {},
): Promise<MailPageData | null> {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;

  const plugins = await getConnectedCorsairPlugins(tenantId);
  const gmailConnected = plugins.includes("gmail");
  if (!gmailConnected) {
    return { tenantId, gmailConnected: false };
  }

  const view = opts.view ?? "INBOX";

  const labelDef = MAIL_LABELS.find((l) => l.id === view);
  let labelIds: string[] | undefined;
  let viewQuery: string | undefined;
  if (labelDef?.gmailQuery) {
    // ARCHIVE and any future query-based views
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
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      force: opts.force,
      labelIds,
      q: viewQuery,
    }),
    getProfile(),
    getLabels(),
  ]);

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}

// ─── Thread Actions ──────────────────────────────────────────────────────────
//
// Each mutation invalidates the mail-list response cache (Phase 9) so that
// the next page load reflects the new state.

export async function archiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["INBOX"],
  });
}

export async function unarchiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["INBOX"],
  });
}

export async function trashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.trash({ id: threadId });
}

export async function untrashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.untrash({ id: threadId });
}

export async function starThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["STARRED"],
  });
}

export async function unstarThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["STARRED"],
  });
}

export async function markAsUnread(ids: string[]): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.messages.batchModify({
    ids,
    addLabelIds: ["UNREAD"],
  });
}

export async function moveToSpam(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
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
  invalidateMailListCache();
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
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: [labelId],
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCache();
  await ctx.client.gmail.api.threads.delete({ id: threadId });
}

// ─── Send / Reply / Forward ──────────────────────────────────────────────────

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

  // Fetch the original message to get headers
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

  // Build recipient list
  const profile = await getProfile();
  const myEmail = profile?.emailAddress?.toLowerCase() || "";
  const replyTo: string[] = [];

  // Always reply to the sender
  if (originalFrom) {
    const senderEmail = extractEmail(originalFrom).toLowerCase();
    if (senderEmail !== myEmail) {
      replyTo.push(originalFrom);
    }
  }

  if (options.replyAll) {
    // Add all To recipients (except self and original sender)
    if (originalTo) {
      for (const addr of originalTo.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail && email !== extractEmail(originalFrom).toLowerCase()) {
          replyTo.push(addr.trim());
        }
      }
    }
    // Add CC recipients (except self)
    if (originalCc) {
      const ccRecipients: string[] = [];
      for (const addr of originalCc.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail) {
          ccRecipients.push(addr.trim());
        }
      }
      if (ccRecipients.length > 0) {
        // Send with CC
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

  // If no valid recipients, fall back to original sender
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

  // Fetch the original message
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
    threadId: (result as { threadId?: string }).threadId || threadId,
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
  invalidateMailListCache();

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

  const raw = buildEncodedMimeMessage({
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

  const raw = buildEncodedMimeMessage({
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
