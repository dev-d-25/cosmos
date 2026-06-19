"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { useRouter, useSearchParams } from "next/navigation";

import { SignOutButton } from "@/components/auth-buttons";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, decodeHtmlEntities, linkifyText } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { EmailIframe } from "@/components/email-iframe";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type {
  MailListItem,
  MailMessage,
  MailListResponse,
  MailProfile,
  MailLabel,
} from "@/server/mail/schemas";
import {
  useMailThreads,
  useMailMessage,
  useMailLabels,
  useMailProfile,
} from "@/hooks/use-mail";
import { markAsReadLocally, isReadLocally } from "@/lib/read-emails";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchPageData {
  list: MailListResponse;
  profile: MailProfile | null;
  labels: MailLabel[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatReceived(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Quick Filters ───────────────────────────────────────────────────────────

const QUICK_FILTERS = [
  { label: "Unread", query: "is:unread" },
  { label: "Starred", query: "is:starred" },
  { label: "Attachments", query: "has:attachment" },
  { label: "Archived", query: "-label:inbox" },
];

// ─── Top Navigation ──────────────────────────────────────────────────────────

function SearchTopNav({
  profile,
}: {
  profile: { emailAddress?: string } | null;
}) {
  return (
    <nav className="border-border bg-card flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="flex gap-0.5 text-xs font-medium">
        <Link
          href="/mail"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Mail
        </Link>
        <Link
          href="/calendar"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Calendar
        </Link>
        <Link
          href="/agent"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Agent
        </Link>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <div className="bg-border h-5 w-px" />
        <ProfileDropdown profile={profile} />
        <ThemeToggle />
        <SignOutButton className="hidden h-8 px-3 text-[0.55rem] tracking-widest uppercase lg:flex" />
      </div>
    </nav>
  );
}

// ─── Profile Dropdown ────────────────────────────────────────────────────────

function ProfileDropdown({ profile }: { profile: { emailAddress?: string; name?: string } | null }) {
  const email = profile?.emailAddress ?? "";
  const displayName = profile?.name || email.split("@")[0] || "Account";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="border-border bg-muted flex size-8 items-center justify-center border text-[0.625rem] font-bold tracking-wider uppercase"
          />
        }
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="text-muted-foreground text-xs leading-none">
              {email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <SignOutButton className="w-full" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Mail Toolbar Button ─────────────────────────────────────────────────────

function MailToolbarButton({
  children,
  label,
  shortcut,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 w-8 shrink-0"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <span>{label}</span>
        {shortcut && <Kbd className="ml-1">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Search Results List ─────────────────────────────────────────────────────

function SearchResultsList({
  items,
  selectedId,
  onSelect,
  onOpen,
  loading,
  isInitialLoading,
  query,
  onClearQuery,
}: {
  items: MailListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  loading: boolean;
  isInitialLoading: boolean;
  query: string;
  onClearQuery: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-message-id="${selectedId}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (isInitialLoading) {
    return (
      <div className="border-border bg-card flex min-w-0 flex-col border-r">
        <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <span className="text-sm font-semibold">Search results</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-border border-b px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <div className="bg-muted size-1.5 shrink-0 animate-pulse rounded-full" />
                  <div className="bg-muted h-3 w-32 animate-pulse rounded" />
                  <div className="bg-muted ml-auto h-2 w-10 animate-pulse rounded" />
                </div>
                <div className="bg-muted ml-3.5 mb-1 h-2.5 w-48 animate-pulse rounded" />
                <div className="bg-muted ml-3.5 h-2 w-64 animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-card flex min-w-0 flex-col border-r">
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        {query ? (
          <div className="flex items-center gap-2">
            <svg className="text-muted-foreground size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span className="text-sm font-semibold">{query}</span>
            <button
              type="button"
              onClick={onClearQuery}
              className="text-muted-foreground hover:text-foreground ml-1 inline-flex size-4 items-center justify-center rounded-full hover:bg-muted"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <span className="text-sm font-semibold">Search results</span>
        )}
        {loading && (
          <div className="ml-2 size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
            <p>{query ? "No results found." : "Type a search query to find emails."}</p>
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedId === item.id;
            const isRead = !item.unread || isReadLocally(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => onOpen(item.id)}
                data-message-id={item.id}
                data-selected={isSelected ? "true" : "false"}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "border-border flex w-full flex-col gap-0.5 border-b px-4 py-2.5 text-left transition-colors",
                  isSelected
                    ? "bg-accent"
                    : "hover:bg-muted/50",
                  isRead && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  {!isRead && (
                    <div className="bg-primary size-1.5 shrink-0 rounded-full" />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate text-xs", !isRead && "font-semibold")}>
                    {decodeHtmlEntities(item.from) || "(unknown)"}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[0.625rem]">
                    {formatReceived(item.receivedAt)}
                  </span>
                </div>
                <div className="ml-3.5 flex min-w-0 flex-col gap-0.5">
                  <span className={cn("truncate text-xs", !isRead && "font-semibold")}>
                    {decodeHtmlEntities(item.subject) || "(no subject)"}
                  </span>
                  <span className="text-muted-foreground truncate text-[0.625rem]">
                    {decodeHtmlEntities(item.snippet)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Mail Viewer ─────────────────────────────────────────────────────────────

function MailViewer({
  selectedListItem,
  message,
  messageSource,
  messageLoading,
  messageError,
  onRetryMessage,
  onCloseMessage,
  onAction,
}: {
  selectedListItem: MailListItem | null;
  message: MailMessage | null;
  messageSource: "cache" | "live" | null;
  messageLoading: boolean;
  messageError: string | null;
  onRetryMessage: () => void;
  onCloseMessage: () => void;
  onAction: (action: string, threadId: string, extra?: Record<string, unknown>) => void;
}) {
  const showEmpty = !messageLoading && !message && !messageError;

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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
            <Badge variant="secondary" className="w-fit">Error</Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              Couldn&apos;t load this message
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">{messageError}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" onClick={onRetryMessage}>Retry</Button>
              <Button type="button" variant="outline" onClick={onCloseMessage}>Close</Button>
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
                <EmailIframe
                  html={message.bodyHtml}
                  messageId={message.id}
                  inlineImages={message.inlineImages}
                />
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
                    <li key={att.attachmentId} className="flex items-center gap-2 text-xs">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span className="truncate">{att.filename}</span>
                      <span className="text-muted-foreground text-[0.625rem]">{att.mimeType}</span>
                      <span className="text-muted-foreground text-[0.625rem]">
                        ({formatSize(att.size)})
                      </span>
                      <a
                        href={`/api/mail/messages/${message.id}/attachments/${att.attachmentId}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline ml-auto shrink-0"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ) : showEmpty ? (
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">Search</Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              {selectedListItem
                ? selectedListItem.subject || "(no subject)"
                : "Select a thread"}
            </h1>
            {selectedListItem ? (
              <>
                <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
                  {decodeHtmlEntities(selectedListItem.from)} · {formatReceived(selectedListItem.receivedAt)}
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
                Pick a conversation from the list on the left to read the full message.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

// ─── Main Search Interface ───────────────────────────────────────────────────

export function SearchInterface({
  initialQuery,
  initialResults,
  gmailConnected,
}: {
  initialQuery: string;
  initialResults?: SearchPageData;
  gmailConnected: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(initialQuery);
  const [inputValue, setInputValue] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const gPressedRef = useRef(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const threadsQuery = useMailThreads({
    page: 1,
    q: query || undefined,
    initialData: initialResults?.list,
  });

  const labelsQuery = useMailLabels(initialResults?.labels);
  const profileQuery = useMailProfile(initialResults?.profile);

  const profile = profileQuery.data ?? null;

  // Sync URL when query changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const url = query ? `/search?${params.toString()}` : "/search";
    router.replace(url, { scroll: false });
  }, [query, router]);

  // Sync initial query from URL
  useEffect(() => {
    if (initialQuery !== query) {
      setQuery(initialQuery);
      setInputValue(initialQuery);
    }
  }, [initialQuery]);

  const items: MailListItem[] = (() => {
    const raw = threadsQuery.data?.items ?? [];
    const seen = new Set<string>();
    return raw.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  })();

  const selectedListItem = items.find((i) => i.id === selectedId) ?? null;

  const messageQuery = useMailMessage(selectedId);

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    markAsReadLocally(id);
  }, []);

  const onOpen = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const onClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  const onSearch = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      setQuery(trimmed);
    } else {
      setQuery("");
    }
  }, [inputValue]);

  const onQuickFilter = useCallback((filterQuery: string) => {
    setInputValue(filterQuery);
    setQuery(filterQuery);
  }, []);

  const onClearQuery = useCallback(() => {
    setInputValue("");
    setQuery("");
    setSelectedId(null);
  }, []);

  const onMailAction = useCallback(
    async (action: string, threadId: string, extra?: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/mail/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, threadId, ...extra }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          console.error(`[mail action] ${action} failed:`, err.error);
          return;
        }
        if (["archive", "trash", "delete", "spam"].includes(action)) {
          setSelectedId(null);
        }
        threadsQuery.refetch();
      } catch (err) {
        console.error(`[mail action] ${action} error:`, err);
      }
    },
    [threadsQuery],
  );

  // Focus input on mount
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keyboard shortcut: Cmd+K focuses search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Stable refs for keyboard handler
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onMailActionRef = useRef(onMailAction);
  onMailActionRef.current = onMailAction;
  const gPressedStateRef = useRef(gPressed);
  gPressedStateRef.current = gPressed;

  // Keyboard shortcuts: j/k/arrows, Enter, actions, g+key navigation
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const currentItems = itemsRef.current;
      const currentSelectedId = selectedIdRef.current;

      // g+key state machine
      if (gPressedStateRef.current) {
        gPressedStateRef.current = false;
        setGPressed(false);
        if (gTimeoutRef.current) {
          clearTimeout(gTimeoutRef.current);
          gTimeoutRef.current = null;
        }

        if (event.key === "i") {
          event.preventDefault();
          router.push("/mail?label=INBOX");
          return;
        } else if (event.key === "d") {
          event.preventDefault();
          router.push("/mail?label=DRAFT");
          return;
        } else if (event.key === "t") {
          event.preventDefault();
          router.push("/mail?label=SENT");
          return;
        } else if (event.key === "a") {
          event.preventDefault();
          router.push("/mail?label=ARCHIVE");
          return;
        } else if (event.key === "s") {
          event.preventDefault();
          router.push("/mail?label=STARRED");
          return;
        }
        // If not a valid g+key combo, fall through to normal handling
      }

      if (event.key === "g") {
        event.preventDefault();
        gPressedStateRef.current = true;
        setGPressed(true);
        if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
        gTimeoutRef.current = setTimeout(() => {
          gPressedStateRef.current = false;
          setGPressed(false);
          gTimeoutRef.current = null;
        }, 1000);
        return;
      }

      if (!currentItems.length) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId((current) => {
          const idx = current ? currentItems.findIndex((i) => i.id === current) : -1;
          const next = currentItems[Math.min(currentItems.length - 1, idx + 1)];
          return next?.id ?? current;
        });
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId((current) => {
          if (!current) return currentItems[currentItems.length - 1]?.id ?? null;
          const idx = currentItems.findIndex((i) => i.id === current);
          const next = currentItems[Math.max(0, idx - 1)];
          return next?.id ?? current;
        });
      } else if (event.key === "Enter" || event.key === "o") {
        if (currentSelectedId) {
          event.preventDefault();
          onOpen(currentSelectedId);
        }
      } else if (event.key === "Escape") {
        if (currentSelectedId) {
          event.preventDefault();
          onClose();
        }
      } else if (event.key === "e" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("archive", currentSelectedId);
      } else if (event.key === "#" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("trash", currentSelectedId);
      } else if (event.key === "s" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("star", currentSelectedId);
      } else if (event.key === "u" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("markUnread", currentSelectedId);
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
    };
  }, [router, onOpen, onClose]);

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <SearchTopNav profile={profile} />

      {/* Search input area */}
      <div className="border-border bg-card shrink-0 border-b px-6 py-4">
        <div className="relative">
          <svg
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-10 w-full rounded-none border px-4 pr-20 pl-10 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search mail... (supports Gmail syntax: from:, subject:, is:unread, has:attachment)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
              if (e.key === "Escape") {
                onClearQuery();
                inputRef.current?.blur();
              }
            }}
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Kbd className="text-[0.625rem]">Cmd K</Kbd>
          </span>
        </div>

        {/* Quick filters */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.query}
              type="button"
              onClick={() => onQuickFilter(filter.query)}
              className={cn(
                "border-border text-muted-foreground hover:bg-accent hover:text-foreground rounded-none border px-2.5 py-1 text-[0.625rem] font-medium transition-colors",
                query === filter.query && "bg-accent text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content: results + viewer */}
      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={35} minSize={25}>
          <SearchResultsList
            items={items}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
            loading={threadsQuery.isFetching}
            isInitialLoading={threadsQuery.isLoading}
            query={query}
            onClearQuery={onClearQuery}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={65} minSize={30}>
          <MailViewer
            selectedListItem={selectedListItem}
            message={messageQuery.data?.message ?? null}
            messageSource={messageQuery.data?.source ?? null}
            messageLoading={messageQuery.isLoading}
            messageError={messageQuery.error?.message ?? null}
            onRetryMessage={() => messageQuery.refetch()}
            onCloseMessage={onClose}
            onAction={onMailAction}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* g+key visual indicator */}
      {gPressed && (
        <div className="fixed bottom-4 left-4 z-50">
          <span className="bg-foreground text-background inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium shadow-lg">
            g
          </span>
        </div>
      )}

      {/* Keyboard shortcuts help */}
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
