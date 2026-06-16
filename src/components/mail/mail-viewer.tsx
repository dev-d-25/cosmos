"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/connect-button";
import { EmailIframe } from "@/components/email-iframe";
import { MailToolbarButton } from "./mail-toolbar-button";
import { StarIcon } from "lucide-react";
import { cn, decodeHtmlEntities, linkifyText } from "@/lib/utils";
import { formatReceived } from "@/lib/mail/format";
import type { MailListItem, MailMessage } from "@/server/mail/schemas";

export function MailViewer({
  gmailConnected,
  selectedListItem,
  message,
  messageSource,
  messageLoading,
  messageError,
  onRetryMessage,
  onCloseMessage,
  onAction,
  labelName,
}: {
  gmailConnected: boolean;
  selectedListItem: MailListItem | null;
  message: MailMessage | null;
  messageSource: "cache" | "live" | null;
  messageLoading: boolean;
  messageError: string | null;
  onRetryMessage: () => void;
  onCloseMessage: () => void;
  onAction: (action: string, threadId: string, extra?: Record<string, unknown>) => void;
  labelName: string;
}) {
  const router = useRouter();

  const showEmpty = !messageLoading && !message && !messageError;

  if (!gmailConnected) {
    return (
    <main className="bg-background flex min-w-0 flex-col overflow-hidden border-l border-border">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">
              Gmail required
            </Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              Connect Gmail
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
              Connect your Gmail with Corsair to unlock the Cosmos Mail
              interface. We will use your Better Auth tenant ID to attach this
              Gmail account to your workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ConnectButton plugin="gmail" />
              <Button
                variant="outline"
                onClick={() => router.push("/mail?label=INBOX&refresh=true")}
              >
                Refresh status
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-background flex min-w-0 flex-col overflow-hidden">
      <div className="border-border bg-card flex h-12 shrink-0 items-center gap-0.5 border-b px-2">
        <MailToolbarButton label="Reply" shortcut="R">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton label="Reply All" shortcut="A">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
            <polyline points="15 14 11 9 15 4" />
            <path d="M22 20v-7a4 4 0 0 0-4-4H8" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton label="Forward" shortcut="F">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 14 19 9 15 4" />
            <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
          </svg>
        </MailToolbarButton>
        <div className="bg-border mx-1 h-5 w-px" />
        <MailToolbarButton
          label="Archive"
          shortcut="E"
          onClick={() => selectedListItem && onAction("archive", selectedListItem.threadId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton
          label="Delete"
          shortcut="#"
          onClick={() => selectedListItem && onAction("trash", selectedListItem.threadId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton
          label="Mark Unread"
          shortcut="U"
          onClick={() => selectedListItem && onAction("markUnread", selectedListItem.threadId, { ids: [selectedListItem.id] })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton
          label="Star"
          shortcut="S"
          onClick={() => selectedListItem && onAction("star", selectedListItem.threadId)}
        >
          <StarIcon size={14} />
        </MailToolbarButton>
        <div className="bg-border mx-1 h-5 w-px" />
        <MailToolbarButton label="Label" shortcut="L">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        </MailToolbarButton>
        <MailToolbarButton label="Create Event">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </MailToolbarButton>
        {message || messageLoading || messageError ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCloseMessage}
            className="ml-auto h-8 w-8"
            aria-label="Close message"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {messageError ? (
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">
              Error
            </Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              Couldn&apos;t load this message
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
              {messageError}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" onClick={onRetryMessage}>
                Retry
              </Button>
              <Button type="button" variant="outline" onClick={onCloseMessage}>
                Close
              </Button>
            </div>
          </div>
        ) : messageLoading ? (
          <div className="border-border bg-card flex min-h-full flex-col gap-3 border p-6">
            <div className="bg-muted h-3 w-24 animate-pulse" />
            <div className="bg-muted h-6 w-3/4 animate-pulse" />
            <div className="bg-muted h-3 w-40 animate-pulse" />
            <div className="mt-6 flex flex-col gap-2">
              <div className="bg-muted h-3 w-full animate-pulse" />
              <div className="bg-muted h-3 w-full animate-pulse" />
              <div className="bg-muted h-3 w-5/6 animate-pulse" />
              <div className="bg-muted h-3 w-2/3 animate-pulse" />
            </div>
          </div>
        ) : message ? (
          <article className="border-border bg-card flex min-h-full flex-col border p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="w-fit">
                {decodeHtmlEntities(message.from) || "Inbox"}
              </Badge>
              {messageSource ? (
                <span className="text-muted-foreground text-[0.625rem] tracking-[0.16em] uppercase">
                  {messageSource === "cache" ? "Cached" : "Live"}
                </span>
              ) : null}
            </div>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              {decodeHtmlEntities(message.subject) || "(no subject)"}
            </h1>
            <div className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
              <p>
                <span className="text-foreground font-semibold">From:</span>{" "}
                {decodeHtmlEntities(message.from) || "(unknown)"}
              </p>
              {message.to ? (
                <p>
                  <span className="text-foreground font-semibold">To:</span>{" "}
                  {message.to}
                </p>
              ) : null}
              {message.cc ? (
                <p>
                  <span className="text-foreground font-semibold">Cc:</span>{" "}
                  {message.cc}
                </p>
              ) : null}
              {message.date ? (
                <p>
                  <span className="text-foreground font-semibold">Date:</span>{" "}
                  {message.date}
                </p>
              ) : null}
            </div>
            {message.bodyHtml ? (
              <div className="mt-6">
                <EmailIframe html={message.bodyHtml} />
              </div>
            ) : message.bodyText ? (
              <pre
                className="text-foreground mt-6 max-w-none text-sm leading-relaxed whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: linkifyText(message.bodyText) }}
              />
            ) : (
              <p className="text-muted-foreground mt-6 text-sm">
                {decodeHtmlEntities(message.snippet) || "(no body)"}
              </p>
            )}
            {message.attachments.length > 0 ? (
              <div className="mt-6 border-t pt-4">
                <p className="text-muted-foreground mb-2 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
                  Attachments ({message.attachments.length})
                </p>
                <ul className="flex flex-col gap-1.5">
                  {message.attachments.map((att: { attachmentId: string; filename: string; mimeType: string; size: number }) => (
                    <li
                      key={att.attachmentId}
                      className="flex items-center gap-2 text-xs"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span className="truncate">{att.filename}</span>
                      <span className="text-muted-foreground text-[0.625rem]">
                        {att.mimeType}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ) : showEmpty ? (
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">
              {labelName}
            </Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              {selectedListItem
                ? selectedListItem.subject || "(no subject)"
                : "Select a thread"}
            </h1>
            {selectedListItem ? (
              <>
                <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
                  {decodeHtmlEntities(selectedListItem.from)} ·{" "}
                  {formatReceived(selectedListItem.receivedAt)}
                </p>
                <p className="text-foreground mt-4 max-w-xl text-sm leading-relaxed">
                  {decodeHtmlEntities(selectedListItem.snippet)}
                </p>
                <p className="text-muted-foreground mt-4 text-[0.625rem] tracking-[0.16em] uppercase">
                  Press Enter or click the row again to open the full message.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
                Pick a conversation from the list on the left to read the full
                message.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
