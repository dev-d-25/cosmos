import type {
  MailLabelSchema,
  MailListItemSchema,
  MailListResponseSchema,
  MailMessageSchema,
  MailProfileSchema,
} from "./schemas";
import type { z } from "zod";

type MailListItem = z.infer<typeof MailListItemSchema>;
type MailMessage = z.infer<typeof MailMessageSchema>;
type MailListResponse = z.infer<typeof MailListResponseSchema>;
type MailLabel = z.infer<typeof MailLabelSchema>;
type MailProfile = z.infer<typeof MailProfileSchema>;

export type {
  MailAttachment,
  MailLabel,
  MailListItem,
  MailListResponse,
  MailMessage,
  MailProfile,
} from "./schemas";

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
