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
  MailListResponse,
  MailPageData,
  MailProfile,
} from "./types";

const INBOX_LABEL = "INBOX";
const DEFAULT_LIMIT = 50;
const WARMUP_CONCURRENCY = 6;

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  return { tenantId, client: corsair.withTenant(tenantId) };
}

export async function getMailList(
  opts: { limit?: number; force?: boolean } = {},
): Promise<MailListResponse> {
  const ctx = await getClient();
  if (!ctx) return { items: [], nextPageToken: null, source: "cache" };
  const limit = opts.limit ?? DEFAULT_LIMIT;

  if (!opts.force) {
    const cached = await ctx.client.gmail.db.messages.list({
      limit,
      offset: 0,
    });
    if (cached.length > 0 && cached.some((r) => r.data.subject)) {
      return {
        items: cached
          .filter((r) => MailListItemSchema.safeParse(r.data).success)
          .map(toListItem)
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
        nextPageToken: null,
        source: "cache",
      };
    }
  }

  await warmInboxCache(ctx.client, limit);
  const rows = await ctx.client.gmail.db.messages.list({ limit, offset: 0 });
  return {
    items: rows
      .filter((r) => MailListItemSchema.safeParse(r.data).success)
      .map(toListItem)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    nextPageToken: null,
    source: "live",
  };
}

async function warmInboxCache(
  client: ReturnType<typeof corsair.withTenant>,
  limit: number,
): Promise<void> {
  const listResult = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: limit,
    labelIds: [INBOX_LABEL],
  });

  const ids = (listResult.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += WARMUP_CONCURRENCY) {
    chunks.push(ids.slice(i, i + WARMUP_CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map((id) =>
        client.gmail.api.messages.get({
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        }),
      ),
    );
  }
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
  await warmInboxCache(ctx.client, DEFAULT_LIMIT);
  const rows = await ctx.client.gmail.db.messages.list({
    limit: DEFAULT_LIMIT,
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
  opts: { force?: boolean } = {},
): Promise<MailPageData | null> {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;

  const plugins = await getConnectedCorsairPlugins(tenantId);
  const gmailConnected = plugins.includes("gmail");
  if (!gmailConnected) {
    return { tenantId, gmailConnected: false };
  }

  const [list, profile, labels] = await Promise.all([
    getMailList({ limit: DEFAULT_LIMIT, force: opts.force }),
    getProfile(),
    getLabels(),
  ]);

  return { tenantId, gmailConnected: true, list, profile, labels };
}
