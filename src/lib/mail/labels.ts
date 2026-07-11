export interface LabelDef {
  id: string;
  name: string;
  gmailLabel?: string;
  gmailQuery?: string;
}

export const MAIL_LABELS: LabelDef[] = [
  { id: "INBOX", name: "Inbox", gmailLabel: "CATEGORY_PERSONAL" },
  { id: "IMPORTANT", name: "Important", gmailLabel: "IMPORTANT" },
  { id: "STARRED", name: "Starred", gmailLabel: "STARRED" },
  { id: "SENT", name: "Sent", gmailLabel: "SENT" },
  { id: "DRAFT", name: "Drafts", gmailLabel: "DRAFT" },
  { id: "ARCHIVE", name: "Archive", gmailQuery: "-label:inbox" },
  { id: "SPAM", name: "Spam", gmailLabel: "SPAM" },
];

export function getGmailParamsForView(view: string): { labelIds?: string[]; query?: string } {
  const def = MAIL_LABELS.find((l) => l.id === view);
  if (!def) return {};
  if (def.gmailQuery) return { query: def.gmailQuery };
  if (def.gmailLabel) return { labelIds: [def.gmailLabel] };
  return {};
}

/**
 * Canonical UI-view-id → Gmail params resolver, shared by the list path
 * (getMailPageData) and the refresh path (refreshInbox) so they always agree.
 *
 * Unlike getGmailParamsForView, this handles dynamic `CATEGORY_*` / `Label_*`
 * ids and falls back to INBOX for unknown ids — so refreshing a custom/user
 * label resolves the same Gmail label the list renders.
 */
export function resolveViewParams(viewId: string): {
  labelIds?: string[];
  query?: string;
} {
  const def = MAIL_LABELS.find((l) => l.id === viewId);
  if (def?.gmailQuery) return { query: def.gmailQuery };
  if (def?.gmailLabel) return { labelIds: [def.gmailLabel] };
  if (viewId.startsWith("CATEGORY_") || viewId.startsWith("Label_")) {
    return { labelIds: [viewId] };
  }
  return { labelIds: ["INBOX"] };
}

export function getLabelById(id: string): LabelDef | undefined {
  return MAIL_LABELS.find((l) => l.id === id);
}

export const MAIL_LABEL_MAP: Record<string, string[] | undefined> = Object.fromEntries(
  MAIL_LABELS
    .filter((l) => l.gmailLabel && !l.id.startsWith("divider"))
    .map((l) => [l.id, [l.gmailLabel!]])
);
