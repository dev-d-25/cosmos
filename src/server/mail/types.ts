export type {
  MailListItem,
  MailListResponse,
  MailAttachment,
  MailMessage,
  MailLabel,
  MailProfile,
} from "./schemas";

export type MailPageData =
  | { tenantId: string; gmailConnected: false }
  | {
      tenantId: string;
      gmailConnected: true;
      list: MailListResponse;
      profile: MailProfile | null;
      labels: MailLabel[];
    };
