import { z } from "zod";

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
  messagesTotal: z.number().optional().default(0),
  messagesUnread: z.number().optional().default(0),
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

export const MailListResponseSchema = z.object({
  items: z.array(MailListItemSchema),
  nextPageToken: z.string().nullable(),
  source: z.enum(["cache", "live"]),
  totalCount: z.number().int().nonnegative().default(0),
});

export const MailThreadsQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  token: z.string().optional(),
  refresh: z.enum(["true", "false"]).default("false"),
});

export const MailMessageQuerySchema = z.object({
  refresh: z.enum(["true", "false"]).default("false"),
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
