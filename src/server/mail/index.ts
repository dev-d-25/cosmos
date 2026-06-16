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
} from "./schemas";
import { MAIL_LABEL_MAP } from "@/lib/mail/labels";

const INBOX_LABEL = "INBOX";
const DEFAULT_PAGE_SIZE = 50;
const ENRICH_CONCURRENCY = 10;
const CACHE_PAGE_TOKEN_PREFIX = "cache:";

async function enrichStubs(
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
): Promise<void> {
  const needsEnrichment: string[] = [];
  for (const id of ids) {
    const row = await client.gmail.db.messages.findByEntityId(id);
    if (!row?.data?.subject || !row?.data?.from) {
      needsEnrichment.push(id);
    }
  }
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

  await enrichStubs(client, ids);

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

  if (isQueryMode && !cacheTokenPage) {
    return getMailListFromQuery(ctx.client, opts, pageSize, labelIds);
  }
  if (cacheTokenPage !== null) {
    return getMailListFromCachePage(ctx.client, cacheTokenPage, pageSize, labelIds, isFilteredLabel);
  }
  return getMailListFromNormal(ctx.client, opts, pageSize, labelIds, hasGmailToken, isFilteredLabel);
}

async function getMailListFromQuery(
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
    return { items: [], nextPageToken: null, source: "live" };
  }

  await enrichStubs(client, ids);

  const items: MailListItem[] = [];
  for (const id of ids) {
    const row = await client.gmail.db.messages.findByEntityId(id);
    if (row) {
      const item = toListItem(row);
      if (item.id) items.push(item);
    }
  }

  return {
    items,
    nextPageToken: apiResult.nextPageToken ?? null,
    source: "live",
  };
}

async function getMailListFromCachePage(
  client: ReturnType<typeof corsair.withTenant>,
  cacheTokenPage: number,
  pageSize: number,
  labelIds: string[],
  isFilteredLabel: boolean,
): Promise<MailListResponse> {
  const limit = (cacheTokenPage + 1) * pageSize;
  const cacheLimit = isFilteredLabel ? limit * 10 : limit;
  let cachedAll = await client.gmail.db.messages.list({
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

async function getMailListFromNormal(
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

  if (!opts.force && !hasGmailToken) {
    const cacheLoadLimit = isFilteredLabel ? totalNeeded * 10 : totalNeeded;
    const cachedAll = await client.gmail.db.messages.list({
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

  let nextToken: string | null = null;

  if (pageIndex === 0) {
    const { nextPageToken } = await syncLabelFromGmail(
      client,
      totalNeeded,
      labelIds,
      opts.q,
    );
    if (nextPageToken) {
      nextToken = nextPageToken;
    } else if (!isFilteredLabel) {
      const total = await client.gmail.db.messages.count();
      if (total > (pageIndex + 1) * pageSize) {
        nextToken = makeCachePageToken(pageIndex + 1);
      }
    }
  } else {
    if (!hasGmailToken) {
      return { items: [], nextPageToken: null, source: "cache" };
    }
    const apiResult = await client.gmail.api.messages.list({
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
      await enrichStubs(client, ids);
    }
  }

  const fetchLimit = isFilteredLabel ? totalNeeded * 10 : totalNeeded;
  let rows = await client.gmail.db.messages.list({
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

  const labelIds = MAIL_LABEL_MAP[view] ?? (view.startsWith("CATEGORY_") || view.startsWith("Label_") ? [view] : undefined);

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

// ─── Thread Actions ──────────────────────────────────────────────────────────

export async function archiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["INBOX"],
  });
}

export async function unarchiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["INBOX"],
  });
}

export async function trashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.trash({ id: threadId });
}

export async function untrashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.untrash({ id: threadId });
}

export async function starThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["STARRED"],
  });
}

export async function unstarThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["STARRED"],
  });
}

export async function markAsUnread(ids: string[]): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.messages.batchModify({
    ids,
    addLabelIds: ["UNREAD"],
  });
}

export async function moveToSpam(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
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
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: [labelId],
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
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

export async function clearMailCache(): Promise<{
  deletedMessages: number;
  deletedLabels: number;
}> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");

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
