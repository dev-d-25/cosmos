export { getMailList, getMailPageData } from "./mail-list";
export { refreshInbox } from "./mail-background-sync";
export { assemblePage } from "./mail-page-assembly";
export type { AssembleContext, AssembleOpts } from "./mail-page-assembly";
export { enrichStubs, backfillWindow } from "./mail-ingestion";
export {
  getMailListCacheKey,
  checkMailListCache,
  setMailListCache,
  invalidateMailListCacheForTenant,
} from "./mail-page-cache";
export { getMessage, prefetchFullBody, getAttachmentContent } from "./mail-messages";
export type { AttachmentResult } from "./mail-messages";
export { sendEmail, replyToMessage, forwardMessage } from "./mail-send";
export type { SendEmailParams } from "./mail-send";
export { createDraft, updateDraft, deleteDraft } from "./mail-drafts";
export { getProfile, getLabels } from "./mail-profile";
export { clearMailCache } from "./mail-sync";
export { describeError } from "./mail-utils";
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
