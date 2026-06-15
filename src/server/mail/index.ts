"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
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
} from "./types";

const INBOX_LABEL = "INBOX";
const DEFAULT_PAGE_SIZE = 50;
const ENRICH_CONCURRENCY = 10;
const CACHE_PAGE_TOKEN_PREFIX = "cache:";

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
  return { tenantId, client: corsair.withTenant(tenantId) };
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
 * Fetch message IDs from Gmail for the given label, then enrich any stubs
 * that are missing subject/from using format:"metadata" (headers only, no body).
 * This leverages corsair's auto-caching: messages.list upserts stubs,
 * messages.get upserts enriched data — both write to corsair_entities.
 */
async function syncLabelFromGmail(
  client: ReturnType<typeof corsair.withTenant>,
  limit: number,
  labelIds?: string[],
  q?: string,
): Promise<{ nextPageToken: string | null }> {
  const listResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: limit,
    ...(labelIds?.length ? { labelIds } : {}),
    ...(q ? { q, includeSpamTrash: true } : {}),
  });

  const ids = (listResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) {
    return { nextPageToken: null };
  }

  // Read what corsair auto-cached from messages.list (stubs with labelIds/snippet).
  // Then enrich only those missing subject/from using metadata format (headers only).
  const cached = await client.gmail.db.messages.list({
    limit: ids.length,
    offset: 0,
  });
  const cachedIds = new Set(cached.map((r) => r.data.id));
  const needsEnrichment = ids.filter((id) => {
    if (cachedIds.has(id)) {
      const row = cached.find((r) => r.data.id === id);
      if (row?.data?.subject && row?.data?.from) return false;
    }
    return true;
  });

  // Enrich with format:"metadata" — only fetches headers (Subject, From, To).
  // This is ~10x faster than format:"full" which downloads the entire MIME tree.
  const chunks: string[][] = [];
  for (let i = 0; i < needsEnrichment.length; i += ENRICH_CONCURRENCY) {
    chunks.push(needsEnrichment.slice(i, i + ENRICH_CONCURRENCY));
  }
  for (const chunk of chunks) {
    await Promise.allSettled(
      chunk.map((id) =>
        client.gmail.api.messages.get({
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        }),
      ),
    );
  }

  return {
    nextPageToken:
      ids.length >= limit ? (listResult.nextPageToken ?? null) : null,
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
  if (!ctx) return { items: [], nextPageToken: null, source: "cache" };

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

  // ── Query mode (search / archive): always call Gmail API, no local filter ──
  if (isQueryMode && !cacheTokenPage) {
    const apiResult = await ctx.client.gmail.api.messages.list({
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
      return { items: [], nextPageToken: null, source: "live" };
    }

    // Enrich any stubs
    const cached = await ctx.client.gmail.db.messages.list({
      limit: ids.length,
      offset: 0,
    });
    const cachedIds = new Set(cached.map((r) => r.data.id));
    const needsEnrichment = ids.filter((id) => {
      if (cachedIds.has(id)) {
        const row = cached.find((r) => r.data.id === id);
        if (row?.data?.subject && row?.data?.from) return false;
      }
      return true;
    });
    const chunks: string[][] = [];
    for (let i = 0; i < needsEnrichment.length; i += ENRICH_CONCURRENCY) {
      chunks.push(needsEnrichment.slice(i, i + ENRICH_CONCURRENCY));
    }
    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map((id) =>
          ctx.client.gmail.api.messages.get({
            id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "To", "Date"],
          }),
        ),
      );
    }

    // Read enriched rows back
    const enriched = await ctx.client.gmail.db.messages.list({
      limit: 100,
      offset: 0,
    });
    const enrichedMap = new Map(enriched.map((r) => [r.data.id, r]));
    const items = ids
      .map((id) => {
        const row = enrichedMap.get(id);
        return row ? toListItem(row) : null;
      })
      .filter((item): item is MailListItem => item !== null);

    return {
      items,
      nextPageToken: apiResult.nextPageToken ?? null,
      source: "live",
    };
  }

  // ── Cache-only page (via "cache:N" token). No API call. ──────────────
  if (cacheTokenPage !== null) {
    const limit = (cacheTokenPage + 1) * pageSize;
    const cacheLimit = isFilteredLabel ? limit * 10 : limit;
    let cachedAll = await ctx.client.gmail.db.messages.list({
      limit: cacheLimit,
      offset: 0,
    });
    if (cachedAll.length === 0) {
      return { items: [], nextPageToken: null, source: "cache" };
    }
    let cacheFiltered = isFilteredLabel
      ? filterByLabel(cachedAll, labelIds)
      : cachedAll;
    const page = sortByReceivedDesc(rowsToListItems(cacheFiltered)).slice(
      cacheTokenPage * pageSize,
      (cacheTokenPage + 1) * pageSize,
    );
    const hasMore = cacheFiltered.length > (cacheTokenPage + 1) * pageSize;
    return {
      items: page,
      nextPageToken: hasMore ? makeCachePageToken(cacheTokenPage + 1) : null,
      source: "cache",
    };
  }

  const pageIndex = Math.max(0, Math.floor(opts.pageIndex ?? 0));
  const offset = pageIndex * pageSize;
  const totalNeeded = offset + pageSize;

  // ── Try to serve from corsair's DB cache ─────────────────────────────
  if (!opts.force && !hasGmailToken) {
    // Load enough rows from DB. For filtered labels, load extra since many won't match.
    const cacheLoadLimit = isFilteredLabel ? totalNeeded * 10 : totalNeeded;
    const cachedAll = await ctx.client.gmail.db.messages.list({
      limit: cacheLoadLimit,
      offset: 0,
    });

    if (cachedAll.length > 0) {
      const cacheFiltered = isFilteredLabel
        ? filterByLabel(cachedAll, labelIds)
        : cachedAll;

      const cacheCoversPage =
        cacheFiltered.length >= totalNeeded ||
        cachedAll.length < cacheLoadLimit ||
        (isFilteredLabel && cacheFiltered.length > 0);

      if (cacheCoversPage) {
        const page = sortByReceivedDesc(rowsToListItems(cacheFiltered)).slice(
          offset,
          offset + pageSize,
        );
        const hasMore = cacheFiltered.length > (pageIndex + 1) * pageSize;
        return {
          items: page,
          nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
          source: "cache",
        };
      }
    }
  }

  // ── Cache miss: sync from Gmail API, then read from DB ──────────────
  let nextToken: string | null = null;

  if (pageIndex === 0) {
    const { nextPageToken } = await syncLabelFromGmail(
      ctx.client,
      totalNeeded,
      labelIds,
      opts.q,
    );
    if (nextPageToken) {
      nextToken = nextPageToken;
    } else if (!isFilteredLabel) {
      const total = await ctx.client.gmail.db.messages.count();
      if (total > (pageIndex + 1) * pageSize) {
        nextToken = makeCachePageToken(pageIndex + 1);
      }
    }
  } else {
    if (!hasGmailToken) {
      return { items: [], nextPageToken: null, source: "cache" };
    }
    const apiResult = await ctx.client.gmail.api.messages.list({
      userId: "me",
      maxResults: pageSize,
      pageToken: opts.pageToken!,
      ...(opts.q ? { q: opts.q, includeSpamTrash: true } : { labelIds }),
    });
    nextToken = apiResult.nextPageToken ?? null;

    const ids = (apiResult.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id);

    if (ids.length > 0) {
      // Enrich new stubs with metadata format (headers only).
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += ENRICH_CONCURRENCY) {
        chunks.push(ids.slice(i, i + ENRICH_CONCURRENCY));
      }
      for (const chunk of chunks) {
        await Promise.allSettled(
          chunk.map((id) =>
            ctx.client.gmail.api.messages.get({
              id,
              format: "metadata",
              metadataHeaders: ["Subject", "From", "To", "Date"],
            }),
          ),
        );
      }
    }
  }

  // ── Re-read from corsair DB (auto-cached by the API calls above) ────
  const fetchLimit = isFilteredLabel ? totalNeeded * 10 : totalNeeded;
  let rows = await ctx.client.gmail.db.messages.list({
    limit: fetchLimit,
    offset: 0,
  });
  if (isFilteredLabel) {
    rows = filterByLabel(rows, labelIds);
  }
  const page = sortByReceivedDesc(rowsToListItems(rows)).slice(
    offset,
    offset + pageSize,
  );

  const hasMore =
    rows.length > (pageIndex + 1) * pageSize || nextToken !== null;
  return {
    items: page,
    nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
    source: "live",
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
      return {
        message: cached.data as Record<string, unknown>,
        source: "cache",
      };
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
  await syncLabelFromGmail(ctx.client, DEFAULT_PAGE_SIZE, [INBOX_LABEL]);
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
  const value: MailProfile = {
    emailAddress: parsed.emailAddress,
    messagesTotal: parsed.messagesTotal,
    threadsTotal: parsed.threadsTotal,
    historyId: parsed.historyId,
    cachedAt: new Date().toISOString(),
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

  const LABEL_MAP: Record<string, string[] | undefined> = {
    INBOX: undefined,
    STARRED: ["STARRED"],
    SENT: ["SENT"],
    DRAFT: ["DRAFT"],
    SPAM: ["SPAM"],
    IMPORTANT: ["IMPORTANT"],
    UNREAD: ["UNREAD"],
    CATEGORY_PERSONAL: ["CATEGORY_PERSONAL"],
    CATEGORY_SOCIAL: ["CATEGORY_SOCIAL"],
    CATEGORY_UPDATES: ["CATEGORY_UPDATES"],
    CATEGORY_PROMOTIONS: ["CATEGORY_PROMOTIONS"],
    CATEGORY_FORUMS: ["CATEGORY_FORUMS"],
  };

  const labelIds = LABEL_MAP[view] ?? (view.startsWith("CATEGORY_") || view.startsWith("Label_") ? [view] : undefined);

  const [list, profile, labels] = await Promise.all([
    getMailList({
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      force: opts.force,
      labelIds,
    }),
    getProfile(),
    getLabels(),
  ]);

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}
