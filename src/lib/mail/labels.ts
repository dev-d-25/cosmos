export interface LabelDef {
  id: string;
  name: string;
  gmailLabel?: string;
  gmailQuery?: string;
}

export const MAIL_LABELS: LabelDef[] = [
  // Gmail's "Primary" tab is the CATEGORY_PERSONAL system label. Using it
  // directly (instead of a `category:primary` query) lets resolveCount()
  // call labels.get() and populate messagesUnread in the DB, so the
  // sidebar badge shows the right number (~800-900). A query view would
  // be classified as "search" by classifyView() and the pager would
  // disappear (search returns count=null).
  { id: "INBOX", name: "Inbox", gmailLabel: "CATEGORY_PERSONAL" },
  { id: "STARRED", name: "Starred", gmailLabel: "STARRED" },
  { id: "SENT", name: "Sent", gmailLabel: "SENT" },
  { id: "DRAFT", name: "Drafts", gmailLabel: "DRAFT" },
  { id: "ARCHIVE", name: "Archive", gmailQuery: "-label:inbox" },
  { id: "SPAM", name: "Spam", gmailLabel: "SPAM" },
  // "All Mail" is Gmail's catch-all INBOX count — the number that lives
  // in Gmail's sidebar "Inbox" row (e.g. 694 unread / 953 total). It
  // includes every category. Distinct from the Inbox entry above, which
  // is filtered to Primary.
  { id: "ALL_MAIL", name: "All Mail", gmailLabel: "INBOX" },
  { id: "divider-1", name: "" },
  { id: "IMPORTANT", name: "Important", gmailLabel: "IMPORTANT" },
  { id: "UNREAD", name: "Unread", gmailLabel: "UNREAD" },
  { id: "divider-2", name: "" },
  // The categories below are what Gmail filters OUT of Primary. The user
  // can drill into each one individually.
  { id: "CATEGORY_SOCIAL", name: "Social", gmailLabel: "CATEGORY_SOCIAL" },
  { id: "CATEGORY_UPDATES", name: "Updates", gmailLabel: "CATEGORY_UPDATES" },
  { id: "CATEGORY_PROMOTIONS", name: "Promotions", gmailLabel: "CATEGORY_PROMOTIONS" },
  { id: "CATEGORY_FORUMS", name: "Forums", gmailLabel: "CATEGORY_FORUMS" },
];

export function getGmailParamsForView(view: string): { labelIds?: string[]; query?: string } {
  const def = MAIL_LABELS.find((l) => l.id === view);
  if (!def) return {};
  if (def.gmailQuery) return { query: def.gmailQuery };
  if (def.gmailLabel) return { labelIds: [def.gmailLabel] };
  return {};
}

export function getLabelById(id: string): LabelDef | undefined {
  return MAIL_LABELS.find((l) => l.id === id);
}

export const MAIL_LABEL_MAP: Record<string, string[] | undefined> = Object.fromEntries(
  MAIL_LABELS
    .filter((l) => l.gmailLabel && !l.id.startsWith("divider"))
    .map((l) => [l.id, [l.gmailLabel!]])
);
