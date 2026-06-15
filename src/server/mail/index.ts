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
const WARMUP_CONCURRENCY = 6;
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

export async function getMailList(
  opts: {
    pageIndex?: number;
    pageSize?: number;
    pageToken?: string | null;
    force?: boolean;
    labelIds?: string[];
  } = {},
): Promise<MailListResponse> {
  const ctx = await getClient();
  if (!ctx) return { items: [], nextPageToken: null, source: "cache" };

  const labelIds = opts.labelIds ?? [INBOX_LABEL];

  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const cacheTokenPage = parseCachePageToken(opts.pageToken);
  const hasGmailToken =
    typeof opts.pageToken === "string" &&
    opts.pageToken.length > 0 &&
    !isCachePageToken(opts.pageToken);

  // Cache-only page: requested via "cache:N" token. No API call, ever.
  if (cacheTokenPage !== null) {
    const cachedAll = await ctx.client.gmail.db.messages.list({
      limit: (cacheTokenPage + 1) * pageSize,
      offset: 0,
    });
    if (cachedAll.length === 0) {
      return { items: [], nextPageToken: null, source: "cache" };
    }
    const total = await ctx.client.gmail.db.messages.count();
    const page = sortByReceivedDesc(rowsToListItems(cachedAll)).slice(
      cacheTokenPage * pageSize,
      (cacheTokenPage + 1) * pageSize,
    );
    const hasMore = total > (cacheTokenPage + 1) * pageSize;
    return {
      items: page,
      nextPageToken: hasMore ? makeCachePageToken(cacheTokenPage + 1) : null,
      source: "cache",
    };
  }

  const pageIndex = Math.max(0, Math.floor(opts.pageIndex ?? 0));
  const offset = pageIndex * pageSize;
  const totalNeeded = offset + pageSize;

  // Tier 1, step 1-2: serve from cache when possible.
  if (!opts.force && !hasGmailToken) {
    let cachedAll = await ctx.client.gmail.db.messages.list({
      limit: totalNeeded,
      offset: 0,
    });
    if (cachedAll.length > 0) {
      const needsEnrichment = cachedAll.filter(
        (r) => !r.data.subject || !r.data.from,
      );
      if (needsEnrichment.length > 0) {
        const ids = needsEnrichment
          .map((r) => r.data.id)
          .filter((x): x is string => typeof x === "string");
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += WARMUP_CONCURRENCY) {
          chunks.push(ids.slice(i, i + WARMUP_CONCURRENCY));
        }
        for (const chunk of chunks) {
          await Promise.allSettled(
            chunk.map((id) =>
              ctx.client.gmail.api.messages.get({
                id,
                format: "full",
              }),
            ),
          );
        }
        // Re-read cache after enrichment to pick up from/subject
        cachedAll = await ctx.client.gmail.db.messages.list({
          limit: totalNeeded,
          offset: 0,
        });
      }

      const total = await ctx.client.gmail.db.messages.count();
      let cacheFiltered = cachedAll;
      if (labelIds.length > 0 && labelIds[0] !== INBOX_LABEL) {
        cacheFiltered = cachedAll.filter((r) => {
          const rowLabels = (r.data.labelIds as string[] | undefined) ?? [];
          return labelIds.every((label) => rowLabels.includes(label));
        });
      }
      const cacheCoversPage =
        cacheFiltered.length >= totalNeeded || cacheFiltered.length >= total;
      if (cacheCoversPage) {
        const page = sortByReceivedDesc(rowsToListItems(cacheFiltered)).slice(
          offset,
          offset + pageSize,
        );
        const hasMore = total > (pageIndex + 1) * pageSize;
        return {
          items: page,
          nextPageToken: hasMore ? makeCachePageToken(pageIndex + 1) : null,
          source: "cache",
        };
      }
    }
  }

  // Tier 1, step 3: cache can't satisfy this page. Go live.
  let nextToken: string | null = null;

  if (pageIndex === 0) {
    // Seed/warm page 0 with a single messages.list + per-id metadata fetch.
    // Capture the Gmail pageToken so the user can fetch page 1+ from API.
    const { nextPageToken } = await warmInboxCache(
      ctx.client,
      totalNeeded,
      labelIds,
    );
    if (nextPageToken) {
      nextToken = nextPageToken;
    } else {
      // Live call returned everything we asked for; check the local cache
      // for any rows we already had before deciding "no more".
      const total = await ctx.client.gmail.db.messages.count();
      if (total > (pageIndex + 1) * pageSize) {
        nextToken = makeCachePageToken(pageIndex + 1);
      }
    }
  } else {
    if (!hasGmailToken) {
      // No Gmail cursor and cache is short — return empty page.
      return { items: [], nextPageToken: null, source: "cache" };
    }
    const apiResult = await ctx.client.gmail.api.messages.list({
      userId: "me",
      maxResults: pageSize,
      pageToken: opts.pageToken!,
      labelIds,
    });
    nextToken = apiResult.nextPageToken ?? null;

    const ids = (apiResult.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id);

    if (ids.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += WARMUP_CONCURRENCY) {
        chunks.push(ids.slice(i, i + WARMUP_CONCURRENCY));
      }
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map((id) =>
            ctx.client.gmail.api.messages.get({
              id,
              format: "full",
            }),
          ),
        );
      }
    }
  }

  // Re-read whatever the cache now holds for this page slice.
  const rows = await ctx.client.gmail.db.messages.list({
    limit: totalNeeded,
    offset: 0,
  });
  const page = sortByReceivedDesc(rowsToListItems(rows)).slice(
    offset,
    offset + pageSize,
  );

  return {
    items: page,
    nextPageToken: nextToken,
    source: "live",
  };
}

async function warmInboxCache(
  client: ReturnType<typeof corsair.withTenant>,
  limit: number,
  labelIds: string[] = [INBOX_LABEL],
): Promise<{ nextPageToken: string | null }> {
  const listResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: limit,
    labelIds,
  });

  const ids = (listResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);
  if (ids.length === 0) {
    return { nextPageToken: listResult.nextPageToken ?? null };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += WARMUP_CONCURRENCY) {
    chunks.push(ids.slice(i, i + WARMUP_CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map((id) =>
        client.gmail.api.messages.get({
          id,
          format: "full",
        }),
      ),
    );
  }
  return { nextPageToken: listResult.nextPageToken ?? null };
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
  await warmInboxCache(ctx.client, DEFAULT_PAGE_SIZE);
  const rows = await ctx.client.gmail.db.messages.list({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
  });
  return { synced: rows.length };
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
