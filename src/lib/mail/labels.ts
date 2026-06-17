export interface LabelDef {
  id: string;
  name: string;
  gmailLabel?: string;
  gmailQuery?: string;
}

export const MAIL_LABELS: LabelDef[] = [
  { id: "INBOX", name: "Inbox", gmailQuery: "in:inbox -category:promotions -category:social -category:updates -category:forums" },
  { id: "STARRED", name: "Starred", gmailLabel: "STARRED" },
  { id: "SENT", name: "Sent", gmailLabel: "SENT" },
  { id: "DRAFT", name: "Drafts", gmailLabel: "DRAFT" },
  { id: "ARCHIVE", name: "Archive", gmailQuery: "-label:inbox" },
  { id: "SPAM", name: "Spam", gmailLabel: "SPAM" },
  { id: "divider-1", name: "" },
  { id: "IMPORTANT", name: "Important", gmailLabel: "IMPORTANT" },
  { id: "UNREAD", name: "Unread", gmailLabel: "UNREAD" },
  { id: "divider-2", name: "" },
  { id: "CATEGORY_PERSONAL", name: "Personal", gmailLabel: "CATEGORY_PERSONAL" },
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
