"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { useRouter, useSearchParams } from "next/navigation";

import { SignOutButton } from "@/components/auth-buttons";
import { ConnectButton } from "@/components/connect-button";
import { EmailIframe } from "@/components/email-iframe";
import { Badge } from "@/components/ui/badge";
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
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { CommandIcon, SquarePenIcon, StarIcon } from "lucide-react";
import { ComposeDialog } from "@/components/compose-dialog";
import { useMailShortcuts } from "@/hooks/use-mail-shortcuts";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import type {
  MailLabel,
  MailListItem,
  MailMessage,
  MailPageData,
  MailProfile,
} from "@/server/mail/schemas";
import {
  useMailThreads,
  useMailMessage,
  useMailLabels,
  useMailProfile,
  useRefreshInbox,
  useClearMailCache,
} from "@/hooks/use-mail";
import { markAsReadLocally, isReadLocally } from "@/lib/read-emails";

// ─── Label definitions ──────────────────────────────────────────────────────

interface LabelDef {
  id: string;
  name: string;
  icon: ReactNode;
  gmailLabel?: string;
  gmailQuery?: string;
}

const LABEL_DEFS: LabelDef[] = [
  {
    id: "INBOX",
    name: "Inbox",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
    gmailLabel: "INBOX",
  },
  {
    id: "STARRED",
    name: "Starred",
    icon: <StarIcon size={14} className="shrink-0 opacity-70" />,
    gmailLabel: "STARRED",
  },
  {
    id: "SENT",
    name: "Sent",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    ),
    gmailLabel: "SENT",
  },
  {
    id: "DRAFT",
    name: "Drafts",
    icon: <SquarePenIcon size={14} className="shrink-0 opacity-70" />,
    gmailLabel: "DRAFT",
  },
  {
    id: "ARCHIVE",
    name: "Archive",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="21 8 21 21 3 21 3 8" />
        <rect x="1" y="3" width="22" height="5" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
    ),
    gmailQuery: "-label:inbox",
  },
  {
    id: "SPAM",
    name: "Spam",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    gmailLabel: "SPAM",
  },
  { id: "divider-1", name: "", icon: null },
  {
    id: "IMPORTANT",
    name: "Important",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
      </svg>
    ),
    gmailLabel: "IMPORTANT",
  },
  {
    id: "UNREAD",
    name: "Unread",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7l-10 7L2 7" />
      </svg>
    ),
    gmailLabel: "UNREAD",
  },
  { id: "divider-2", name: "", icon: null },
  {
    id: "CATEGORY_PERSONAL",
    name: "Personal",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    gmailLabel: "CATEGORY_PERSONAL",
  },
  {
    id: "CATEGORY_SOCIAL",
    name: "Social",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    gmailLabel: "CATEGORY_SOCIAL",
  },
  {
    id: "CATEGORY_UPDATES",
    name: "Updates",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
    gmailLabel: "CATEGORY_UPDATES",
  },
  {
    id: "CATEGORY_PROMOTIONS",
    name: "Promotions",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
    gmailLabel: "CATEGORY_PROMOTIONS",
  },
  {
    id: "CATEGORY_FORUMS",
    name: "Forums",
    icon: (
      <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    gmailLabel: "CATEGORY_FORUMS",
  },
];

import { getGmailParamsForView } from "@/lib/mail/labels";

// ─── Helpers ────────────────────────────────────────────────────────────────

function MailToolbarButton({
  children,
  label,
  shortcut,
  onClick,
  variant = "ghost",
}: {
  children: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  variant?: "ghost" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
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

function SidebarItem({
  active = false,
  badge,
  children,
  href,
}: {
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  href?: string;
}) {
  return (
    <Link
      href={href ?? "/mail"}
      className={[
        "text-sidebar-foreground hover:bg-sidebar-accent flex items-center gap-2.5 px-4 py-1.5 text-xs font-medium transition",
        active ? "bg-sidebar-accent text-sidebar-primary" : "",
      ].join(" ")}
    >
      {children}
      {badge ? (
        <span className="bg-primary text-primary-foreground ml-auto rounded-none px-2 py-0.5 text-[0.625rem] font-semibold">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function MailTag({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className="h-4 px-1.5 text-[0.55rem] font-semibold tracking-wide uppercase"
    >
      {children}
    </Badge>
  );
}

function initialsOf(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "?";
  const local = trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;
  const parts = local.split(/[ ._<>]+/).filter(Boolean);
  if (parts.length === 0) return local.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${mon} ${day}` : `${mon} ${day}, ${d.getFullYear()}`;
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function MailSidebar({
  labels,
  activeLabel,
  profile,
  onCompose,
}: {
  labels: MailLabel[];
  activeLabel: string;
  profile: MailProfile | null;
  onCompose: () => void;
}) {
  const email = profile?.emailAddress ?? "";
  const labelMap = useMemo(() => {
    const m = new Map<string, MailLabel>();
    for (const l of labels) m.set(l.id, l);
    return m;
  }, [labels]);

  return (
    <aside className="border-sidebar-border bg-sidebar flex h-full flex-col gap-0 overflow-y-auto border-r p-0">
      <div className="px-3 py-3">
        <Button
          onClick={onCompose}
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-full justify-start gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Compose
        </Button>
      </div>

      <div className="bg-border mx-4 mb-2 h-px" />

      {LABEL_DEFS.map((def) => {
        if (def.id.startsWith("divider-")) {
          return <div key={def.id} className="bg-border mx-4 my-2 h-px" />;
        }
        const label = def.gmailLabel ? labelMap.get(def.gmailLabel) : undefined;
        const unread = label?.messagesUnread;
        return (
          <SidebarItem
            key={def.id}
            active={activeLabel === def.id}
            href={`/mail?label=${def.id}`}
            badge={unread && unread > 0 ? unread.toString() : undefined}
          >
            {def.icon}
            {def.name}
          </SidebarItem>
        );
      })}

      {(() => {
        const userLabels = labels.filter((l) => l.type === "user");
        if (userLabels.length === 0) return null;
        return (
          <>
            <div className="bg-border mx-4 my-2 h-px" />
            <div className="text-muted-foreground flex items-center justify-between px-4 pt-2 pb-1 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
              Labels
            </div>
            {userLabels.map((label) => (
              <SidebarItem
                key={label.id}
                active={activeLabel === label.id}
                href={`/mail?label=${label.id}`}
                badge={label.messagesUnread > 0 ? label.messagesUnread.toString() : undefined}
              >
                <span className="bg-primary size-2" />
                {label.name}
              </SidebarItem>
            ))}
          </>
        );
      })()}
    </aside>
  );
}

// ─── Profile Dropdown ───────────────────────────────────────────────────────

function ProfileDropdown({ profile }: { profile: { emailAddress?: string; name?: string } | null }) {
  const email = profile?.emailAddress ?? "";
  const name = profile?.name ?? email.split("@")[0] ?? "User";
  const initials = initialsOf(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" />}>
        <Avatar size="sm">
          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="px-3">
          <div className="flex items-center gap-2 py-0.5">
            <Avatar size="sm" className="size-7">
              <AvatarFallback className="bg-muted text-[0.625rem] font-bold">
                {initialsOf(email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">{name}</span>
              <span className="text-muted-foreground text-[0.625rem]">
                {email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Top Nav ────────────────────────────────────────────────────────────────

type SyncedState = "Not connected" | "No mail cached" | "Synced" | "Loading...";

function MailTopNav({
  syncedState,
  profile,
  onRefresh,
  onClearCache,
  isRefreshing,
  isClearing,
  onSearchOpen,
  shortcutsOpen,
  onShortcutsOpenChange,
}: {
  syncedState: SyncedState;
  profile: { emailAddress?: string } | null;
  onRefresh: () => void;
  onClearCache: () => void;
  isRefreshing: boolean;
  isClearing: boolean;
  onSearchOpen: () => void;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
}) {
  const email = profile?.emailAddress ?? "";
  const displayName = email.split("@")[0] ?? "Account";

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

      <div className="relative min-w-0 flex-1">
        <svg
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-8 w-full rounded-none border px-3 pr-14 pl-8 text-xs outline-none"
          placeholder="Search mail, events, people, or ask AI..."
          onMouseDown={(e) => {
            e.preventDefault();
            onSearchOpen();
          }}
          readOnly
        />
        <span className="absolute top-1/2 right-2 -translate-y-1/2">
          <Kbd className="text-[0.625rem]">Cmd K</Kbd>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className="hidden items-center gap-1.5 px-2.5 py-1 text-xs lg:inline-flex"
        >
          <span
            className={[
              "size-1.5 rounded-full",
              syncedState === "Synced" ? "bg-primary" : "bg-muted-foreground",
            ].join(" ")}
          />
          {isRefreshing ? "Refreshing..." : syncedState}
        </Badge>

        <div className="bg-border h-5 w-px" />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh inbox"
          className="size-8"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh inbox"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear cache and re-sync"
          className="size-8"
          onClick={onClearCache}
          disabled={isClearing}
          title="Clear local cache and re-fetch from Gmail"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </Button>

        <div className="bg-border h-5 w-px" />

        <ShortcutsHelp open={shortcutsOpen} onOpenChange={onShortcutsOpenChange}>
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md">
                  <CommandIcon size={14} />
                </div>
              }
            />
            <TooltipContent side="bottom" sideOffset={6}>
              <span>Keyboard Shortcuts</span>
              <Kbd className="ml-1">?</Kbd>
            </TooltipContent>
          </Tooltip>
        </ShortcutsHelp>

        <ProfileDropdown profile={profile} />

        <ThemeToggle />

        <SignOutButton className="hidden h-8 px-3 text-[0.55rem] tracking-widest uppercase lg:flex" />
      </div>
    </nav>
  );
}

// ─── Mail List ──────────────────────────────────────────────────────────────

function MailList({
  items,
  selectedId,
  onSelect,
  onOpen,
  page,
  totalPages,
  onPageChange,
  loading,
  error,
  isInitialLoading,
  labelName,
  searchQuery,
  onClearSearch,
  onArchive,
  onDelete,
  onStar,
  onMarkUnread,
  onReply,
  onReplyAll,
  onForward,
  onCompose,
  onSearch,
}: {
  items: MailListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  error: string | null;
  isInitialLoading: boolean;
  labelName: string;
  searchQuery?: string;
  onClearSearch?: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onStar: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onReply: (id: string) => void;
  onReplyAll: (id: string) => void;
  onForward: (id: string) => void;
  onCompose: () => void;
  onSearch: () => void;
}) {
  if (isInitialLoading) {
    return (
      <div className="border-border bg-card flex min-w-0 flex-col border-r">
        <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <span className="text-sm font-semibold">{labelName}</span>
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

  if (items.length === 0) {
    return (
      <div className="border-border bg-card flex min-w-0 flex-col border-r">
        <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
          {searchQuery ? (
            <div className="flex items-center gap-2">
              <svg className="text-muted-foreground size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span className="text-sm font-semibold">{searchQuery}</span>
              <button
                type="button"
                onClick={onClearSearch}
                className="text-muted-foreground hover:text-foreground ml-1 inline-flex size-4 items-center justify-center rounded-full hover:bg-muted"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <span className="text-sm font-semibold">{labelName}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
            <p>{searchQuery ? "No results found." : "No mail in this folder."}</p>
          </div>
        </div>
      </div>
    );
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-message-id="${selectedId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  return (
    <div className="border-border bg-card flex min-w-0 flex-col border-r">
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        {searchQuery ? (
          <div className="flex items-center gap-2">
            <svg className="text-muted-foreground size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span className="text-sm font-semibold">{searchQuery}</span>
            <button
              type="button"
              onClick={onClearSearch}
              className="text-muted-foreground hover:text-foreground ml-1 inline-flex size-4 items-center justify-center rounded-full hover:bg-muted"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <span className="text-sm font-semibold">{labelName}</span>
        )}
        <button
          type="button"
          aria-label="Filter"
          className="border-border text-muted-foreground hover:bg-accent hover:text-foreground ml-auto flex size-7 items-center justify-center border transition"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {items.map((item) => {
          const isSelected = selectedId === item.id;
          const isRead = !item.unread || isReadLocally(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => onOpen?.(item.id)}
              data-message-id={item.id}
              data-selected={isSelected ? "true" : "false"}
              aria-current={isSelected ? "true" : undefined}
              className={cn(
                "border-border hover:bg-accent block w-full border-b border-l-2 border-l-transparent px-4 py-3 text-left transition",
                isRead ? "bg-muted" : "",
                isSelected && "bg-accent border-l-primary",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    isRead ? "bg-muted-foreground" : "bg-primary",
                  )}
                />
                <span className="truncate text-sm font-semibold">
                  {decodeHtmlEntities(item.from) || "(unknown sender)"}
                </span>
                <span className="text-muted-foreground shrink-0 text-[0.625rem]">
                  {formatReceived(item.receivedAt)}
                </span>
              </div>
              <p className="truncate pl-3.5 text-xs font-medium">
                {decodeHtmlEntities(item.subject) || "(no subject)"}
              </p>
              <p className="text-muted-foreground truncate pl-3.5 text-[0.625rem]">
                {decodeHtmlEntities(item.snippet)}
              </p>
              {item.labelIds.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
                  {item.labelIds
                    .filter(
                      (l) =>
                        ![
                          "INBOX",
                          "UNREAD",
                          "IMPORTANT",
                          "CATEGORY_PERSONAL",
                          "CATEGORY_UPDATES",
                        ].includes(l),
                    )
                    .slice(0, 3)
                    .map((label) => (
                      <MailTag key={label}>
                        {label.replace(/^CATEGORY_/, "").replace(/^Label_/, "")}
                      </MailTag>
                    ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 0 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <Button
                  key={pageNum}
                  type="button"
                  variant={pageNum === page ? "default" : "ghost"}
                  size="sm"
                  className="size-8 p-0 text-xs"
                  disabled={loading}
                  onClick={() => onPageChange(pageNum)}
                >
                  {pageNum + 1}
                </Button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="border-border border-t px-4 py-2">
          <p className="text-destructive text-[0.625rem]">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Mail Viewer ────────────────────────────────────────────────────────────

function MailViewer({
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

// ─── Main Interface ─────────────────────────────────────────────────────────

export function MailInterface({
  initial,
  initialLabel,
}: {
  initial: MailPageData;
  initialLabel: string;
}) {
  const gmailConnected = initial.gmailConnected;
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeLabel = searchParams.get("label") ?? initialLabel ?? "INBOX";
  const labelDef = LABEL_DEFS.find((l) => l.id === activeLabel);
  const labelName = labelDef?.name ?? activeLabel;

  // ─── Local UI state ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const gmailParams = searchQuery
    ? { query: searchQuery }
    : getGmailParamsForView(activeLabel);

  // ─── TanStack Query hooks ──────────────────────────────────────────────
  const [pageIndex, setPageIndex] = useState(0);
  const [pageTokens, setPageTokens] = useState<(string | undefined)[]>([undefined]);
  const [pageError, setPageError] = useState<string | null>(null);

  const currentPageToken = pageTokens[pageIndex];

  // Reset pagination when search query or label changes
  useEffect(() => {
    setPageIndex(0);
    setPageTokens([undefined]);
  }, [searchQuery, activeLabel]);

  const threadsQuery = useMailThreads({
    page: pageIndex,
    pageSize: 25,
    token: currentPageToken,
    labelIds: gmailParams.labelIds,
    q: gmailParams.query,
    initialData: initial.gmailConnected ? initial.list : undefined,
  });

  const labelsQuery = useMailLabels(
    initial.gmailConnected ? initial.labels : undefined,
  );

  const profileQuery = useMailProfile(
    initial.gmailConnected ? initial.profile : undefined,
  );

  const refreshMutation = useRefreshInbox();
  const clearCacheMutation = useClearMailCache();

  const messageQuery = useMailMessage(selectedId);

  // ─── Ctrl+K to open search ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  // ─── Derived state ─────────────────────────────────────────────────────
  const items: MailListItem[] = (() => {
    const raw = threadsQuery.data?.items ?? [];
    const seen = new Set<string>();
    return raw.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  })();

  const hasMore = threadsQuery.data?.nextPageToken !== null && threadsQuery.data?.nextPageToken !== undefined;
  const totalPages = Math.max(1, pageIndex + 1 + (hasMore ? 1 : 0));

  const labels: MailLabel[] = labelsQuery.data ?? [];
  const profile: MailProfile | null = profileQuery.data ?? null;

  const syncedState: SyncedState = !gmailConnected
    ? "Not connected"
    : threadsQuery.isLoading
      ? "Loading..."
      : items.length === 0
        ? "No mail cached"
        : "Synced";

  const selectedListItem = items.find((i) => i.id === selectedId) ?? null;

  // ─── Reset page when label changes ────────────────────────────────────
  useEffect(() => {
    setPageIndex(0);
    setPageTokens([undefined]);
    setSelectedId(null);
  }, [activeLabel]);

  // ─── Auto-store next page tokens from query results ───────────────────
  useEffect(() => {
    const token = threadsQuery.data?.nextPageToken;
    if (token) {
      setPageTokens((prev) => {
        if (prev[pageIndex + 1] === token) return prev;
        const next = [...prev];
        next[pageIndex + 1] = token;
        return next;
      });
    }
  }, [threadsQuery.data?.nextPageToken, pageIndex]);

  // ─── Callbacks ─────────────────────────────────────────────────────────
  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    markAsReadLocally(id);
  }, []);

  const onOpen = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const onPageChange = useCallback(
    (newPage: number) => {
      if (newPage === pageIndex) return;
      setPageError(null);
      setPageIndex(newPage);
    },
    [pageIndex],
  );

  const onClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  const onRefresh = useCallback(() => {
    refreshMutation.mutate();
    threadsQuery.refetch();
    labelsQuery.refetch();
  }, [refreshMutation, threadsQuery, labelsQuery]);

  const onClearCache = useCallback(() => {
    clearCacheMutation.mutate(undefined, {
      onSuccess: () => {
        setSelectedId(null);
        setPageIndex(0);
        setPageTokens([undefined]);
        threadsQuery.refetch();
        labelsQuery.refetch();
        profileQuery.refetch();
      },
    });
  }, [clearCacheMutation, threadsQuery, labelsQuery, profileQuery]);

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
        // Optimistic: close viewer and refetch list for destructive actions
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

  // ─── Keyboard shortcuts ────────────────────────────────────────────────
  useMailShortcuts({
    items,
    selectedId,
    setSelectedId,
    onOpen,
    onClose,
    onMailAction,
    composeOpen,
    shortcutsOpen,
    setShortcutsOpen,
  });

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <MailTopNav
        syncedState={syncedState}
        profile={profile}
        onRefresh={onRefresh}
        onClearCache={onClearCache}
        isRefreshing={refreshMutation.isPending}
        isClearing={clearCacheMutation.isPending}
        onSearchOpen={() => router.push("/search")}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={setShortcutsOpen}
      />
      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={12}>
          <MailSidebar labels={labels} activeLabel={activeLabel} profile={profile} onCompose={() => setComposeOpen(true)} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30} minSize={20}>
          <div
            className={cn(
              "relative flex min-w-0 flex-col",
              threadsQuery.isFetching && "pointer-events-none opacity-70",
            )}
          >
            <MailList
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              page={pageIndex}
              totalPages={totalPages}
              onPageChange={onPageChange}
              loading={threadsQuery.isFetching}
              error={pageError}
              isInitialLoading={threadsQuery.isLoading}
              labelName={labelName}
              searchQuery={searchQuery || undefined}
              onClearSearch={() => {
                setSearchQuery("");
              }}
              onArchive={(id) => onMailAction("archive", id)}
              onDelete={(id) => onMailAction("trash", id)}
              onStar={(id) => onMailAction("star", id)}
              onMarkUnread={(id) => onMailAction("markUnread", id)}
              onReply={() => {}}
              onReplyAll={() => {}}
              onForward={() => {}}
              onCompose={() => setComposeOpen(true)}
              onSearch={() => router.push("/search")}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={54} minSize={30}>
          <MailViewer
            gmailConnected={gmailConnected}
            selectedListItem={selectedListItem}
            message={messageQuery.data?.message ?? null}
            messageSource={messageQuery.data?.source ?? null}
            messageLoading={messageQuery.isLoading}
            messageError={messageQuery.error?.message ?? null}
            onRetryMessage={() => messageQuery.refetch()}
            onCloseMessage={onClose}
            onAction={onMailAction}
            labelName={labelName}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Compose dialog */}
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />
    </div>
  );
}
