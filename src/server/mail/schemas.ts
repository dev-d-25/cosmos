import { z } from "zod";

/**
 * Single source of truth for pagination size. SSR, client, route handler,
 * schema validator, and cache keys all use this number. Changing it
 * requires no schema edits — the constant is the schema.
 *
 * 25 was chosen (over Gmail's default 50) for three reasons:
 *   1. Kills the SSR/client 25-vs-50 cache-key mismatch in one place.
 *   2. One Gmail list call covers a full page; the cold path is half the
 *      round-trips of 50.
 *   3. Smaller SSR payload (~7 KB vs ~14 KB) — meaningful on
 *      bandwidth-constrained networks.
 */
export const PAGE_SIZE = 25;

export const MailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  attachmentId: z.string(),
});

export const MailInlineImageSchema = z.object({
  contentId: z.string(),
  attachmentId: z.string().optional(),
  mimeType: z.string(),
  dataUri: z.string().optional(),
});

export const MailListItemSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string().optional(),
  from: z.string().optional(),
  snippet: z.string().optional(),
  receivedAt: z.string(),
  unread: z.boolean(),
  labelIds: z.array(z.string()),
});

export const MailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  cc: z.string().optional().default(""),
  date: z.string().nullable().optional().default(null),
  snippet: z.string().optional().default(""),
  bodyHtml: z.string().optional().default(""),
  bodyText: z.string().optional().default(""),
  attachments: z.array(MailAttachmentSchema).optional().default([]),
  inlineImages: z.array(MailInlineImageSchema).optional().default([]),
});

export const MailLabelSchema = z.object({
  id: z.string(),
  name: z.string().optional().default(""),
  type: z.enum(["system", "user"]).optional().default("system"),
  messagesTotal: z.number().int().nonnegative().optional().default(0),
  messagesUnread: z.number().int().nonnegative().optional().default(0),
  color: z.string().nullable().optional().default(null),
});

export const MailProfileSchema = z.object({
  emailAddress: z.string().optional().default(""),
  messagesTotal: z.number().optional().default(0),
  threadsTotal: z.number().optional().default(0),
  historyId: z.string().optional().default(""),
  cachedAt: z.string().optional().default(""),
  name: z.string().optional().default(""),
  picture: z.string().optional().default(""),
});

/**
 * Pagination response contract (v2).
 *
 * One count, derived everything. The client no longer derives totalPages
 * or hasMore from client-side state — it reads them off the response.
 *
 * - `count`: the total for the view. null for free-text search (no exact
 *   count available from Gmail).
 * - `page`: 1-based, echoed from the request after clamping to
 *   `[1, totalPages]`.
 * - `totalPages`: null when count is null.
 * - `hasMore` / `hasPrev`: pure arithmetic on page + totalPages.
 * - `cacheState`: "full" if DB covers `count`, "partial" if DB has fewer,
 *   "empty" if DB has zero rows. Drives the "Syncing X/Y" pill.
 * - `coverage`: fraction of `count` currently in DB. 1.0 when full.
 * - `source`: "cache" (DB hit), "live" (Gmail round-trip for this page),
 *   "syncing" (partial cache + background sync still filling the gap).
 * - `degraded`: true when count fell back to a less-accurate source.
 */
export const MailListResponseSchema = z.object({
  items: z.array(MailListItemSchema),
  count: z.number().int().nonnegative().nullable(),
  page: z.number().int().positive(),
  totalPages: z.number().int().positive().nullable(),
  hasMore: z.boolean(),
  hasPrev: z.boolean(),
  cacheState: z.enum(["full", "partial", "empty"]),
  coverage: z.number().min(0).max(1),
  source: z.enum(["cache", "live", "syncing"]),
  degraded: z.boolean().optional().default(false),
});

/**
 * Threads query: page is 1-based (matches the URL). pageSize is no longer
 * accepted from the client — PAGE_SIZE is the single constant.
 */
export const MailThreadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  token: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  q: z.string().optional(),
});

export const MailMessageQuerySchema = z.object({
  refresh: z.string().optional(),
});

export const GetProfileApiResponseSchema = z.object({
  emailAddress: z.string().default(""),
  messagesTotal: z.number().default(0),
  threadsTotal: z.number().default(0),
  historyId: z.string().default(""),
});

export const InboxRefreshResponseSchema = z.object({
  synced: z.number().int().nonnegative(),
});

export const MailLabelsResponseSchema = z.array(MailLabelSchema);

export type MailAttachment = z.infer<typeof MailAttachmentSchema>;
export type MailInlineImage = z.infer<typeof MailInlineImageSchema>;
export type MailListItem = z.infer<typeof MailListItemSchema>;
export type MailMessage = z.infer<typeof MailMessageSchema>;
export type MailLabel = z.infer<typeof MailLabelSchema>;
export type MailProfile = z.infer<typeof MailProfileSchema>;
export type MailListResponse = z.infer<typeof MailListResponseSchema>;

export type MailPageData =
  | { tenantId: string; gmailConnected: false }
  | {
      tenantId: string;
      gmailConnected: true;
      view: string;
      list: MailListResponse;
      profile: MailProfile | null;
      labels: MailLabel[];
    };
