import { z } from "zod";

export const MailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  attachmentId: z.string(),
});

export const MailListItemSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: z.string(),
  snippet: z.string(),
  receivedAt: z.string(),
  unread: z.boolean(),
  labelIds: z.array(z.string()),
});

export const MailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  cc: z.string(),
  date: z.string().nullable(),
  snippet: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  attachments: z.array(MailAttachmentSchema),
});

export const MailLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["system", "user"]),
  messagesTotal: z.number(),
  messagesUnread: z.number(),
  color: z.string().nullable(),
});

export const MailProfileSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number(),
  threadsTotal: z.number(),
  historyId: z.string(),
  cachedAt: z.string(),
});

export const MailListResponseSchema = z.object({
  items: z.array(MailListItemSchema),
  nextPageToken: z.string().nullable(),
  source: z.enum(["cache", "live"]),
});

export const MailThreadsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(50),
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
export type MailListItem = z.infer<typeof MailListItemSchema>;
export type MailMessage = z.infer<typeof MailMessageSchema>;
export type MailLabel = z.infer<typeof MailLabelSchema>;
export type MailProfile = z.infer<typeof MailProfileSchema>;
export type MailListResponse = z.infer<typeof MailListResponseSchema>;
