"use server";

export { getMailList, refreshInbox, getMailPageData } from "./mail-list";
export { getMessage, prefetchFullBody, getAttachmentContent } from "./mail-messages";
export type { AttachmentResult } from "./mail-messages";
export { sendEmail, replyToMessage, forwardMessage } from "./mail-send";
export type { SendEmailParams } from "./mail-send";
export { createDraft, updateDraft, deleteDraft } from "./mail-drafts";
export { getProfile, getLabels } from "./mail-profile";
export { clearMailCache } from "./mail-sync";
export { applyThreadAction, markAsRead } from "./thread-actions";
export type { ThreadActionName } from "./thread-actions";
export type {
  MailLabel,
  MailListItem,
  MailListResponse,
  MailPageData,
  MailProfile,
} from "./schemas";
export type { GetMailListOpts } from "./mail-list";
