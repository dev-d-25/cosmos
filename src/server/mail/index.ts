export { getMailList, refreshInbox, getMailPageData, getLabels, getProfile, invalidateMailListCacheForTenant } from "./mail-list";
export type { GetMailListOpts } from "./mail-list";
export { getMessage, prefetchFullBody, getAttachmentContent } from "./mail-messages";
export type { AttachmentResult } from "./mail-messages";
export { sendEmail, replyToMessage, forwardMessage } from "./mail-send";
export type { SendEmailParams } from "./mail-send";
export { createDraft, updateDraft, deleteDraft } from "./mail-drafts";
export { clearMailCache } from "./mail-sync";
export {
  markAsRead,
  archiveThread,
  unarchiveThread,
  trashThread,
  untrashThread,
  starThread,
  unstarThread,
  markAsUnread,
  moveToSpam,
  moveThreadToLabel,
  removeLabelFromThread,
  deleteThread,
} from "./thread-actions";
export {
  MailLabelSchema,
  MailListItemSchema,
  MailListResponseSchema,
  GetProfileApiResponseSchema,
  InboxRefreshResponseSchema,
  PAGE_SIZE,
} from "./schemas";
export type {
  MailLabel,
  MailListItem,
  MailListResponse,
  MailPageData,
  MailProfile,
} from "./schemas";
