"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";

import { SignOutButton } from "@/components/auth-buttons";
import { ConnectButton } from "@/components/connect-button";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import type { MailListItem, MailPageData } from "@/server/mail/types";

function MailToolbarButton({ children }: { children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground flex min-w-[54px] flex-col gap-0.5 border border-transparent px-2.5 py-1 text-[0.625rem] font-medium tracking-wider uppercase"
    >
      {children}
    </Button>
  );
}

function SidebarItem({
  active = false,
  badge,
  children,
}: {
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href="/mail"
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
  if (sameDay)
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function MailSidebar({ gmailConnected }: { gmailConnected: boolean }) {
  return (
    <aside className="border-sidebar-border bg-sidebar flex h-full flex-col gap-1 overflow-y-auto border-r p-0">
      <SidebarItem active badge="12">
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
        Inbox
      </SidebarItem>
      <SidebarItem badge="8">
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 1.01 12 2" />
        </svg>
        Priority
      </SidebarItem>
      <SidebarItem badge="3">
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Needs Reply
      </SidebarItem>
      <SidebarItem>
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 1.01 12 2" />
        </svg>
        Starred
      </SidebarItem>
      <SidebarItem>
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        Sent
      </SidebarItem>
      <SidebarItem badge="2">
        <svg
          className="shrink-0 opacity-70"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 2" />
        </svg>
        Drafts
      </SidebarItem>
      <SidebarItem>Archive</SidebarItem>
      <SidebarItem>Spam</SidebarItem>

      <div className="bg-border my-2 h-px" />

      <div className="text-muted-foreground flex items-center justify-between px-4 pt-4 pb-1 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
        Labels
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <SidebarItem badge="6">
        <span className="bg-primary size-2" />
        Work
      </SidebarItem>
      <SidebarItem badge="4">
        <span className="bg-primary size-2" />
        Personal
      </SidebarItem>
      <SidebarItem badge="2">
        <span className="bg-primary size-2" />
        Finance
      </SidebarItem>
      <SidebarItem badge="1">
        <span className="bg-primary size-2" />
        Travel
      </SidebarItem>

      <div className="bg-border my-2 h-px" />

      <div className="px-4 pt-4 pb-1">
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-[0.55rem] font-bold tracking-[0.16em] uppercase">
          Today
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="flex gap-2.5 py-1">
          <span className="text-muted-foreground min-w-9 text-[0.625rem]">
            9:00
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Standup</p>
            <p className="text-muted-foreground truncate text-[0.625rem]">
              30m, Google Meet
            </p>
          </div>
          <span className="bg-primary mt-1 size-1.5 shrink-0 rounded-full" />
        </div>
        <div className="flex gap-2.5 py-1">
          <span className="text-muted-foreground min-w-9 text-[0.625rem]">
            14:30
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Product Review</p>
            <p className="text-muted-foreground truncate text-[0.625rem]">
              1h, Room 3 / Zoom
            </p>
          </div>
          <span className="bg-primary mt-1 size-1.5 shrink-0 rounded-full" />
        </div>
      </div>

      <div className="bg-border my-2 h-px" />

      <div className="px-4 pt-3 pb-4">
        <p className="text-muted-foreground mb-2 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
          Connected Accounts
        </p>
        <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
          <span className="bg-destructive text-primary-foreground flex size-4 items-center justify-center rounded-sm text-[0.55rem] font-black">
            G
          </span>
          Gmail
          <span className="ml-auto flex items-center gap-1 text-[0.625rem]">
            <span
              className={[
                "size-1.5 rounded-full",
                gmailConnected ? "bg-primary" : "bg-muted-foreground",
              ].join(" ")}
            />
            {gmailConnected ? "Connected" : "Missing"}
          </span>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-sm text-[0.55rem] font-black">
            C
          </span>
          Google Calendar
          <span className="ml-auto flex items-center gap-1 text-[0.625rem]">
            <span className="bg-muted-foreground size-1.5 rounded-full" />
            Coming soon
          </span>
        </div>
      </div>
    </aside>
  );
}

function ProfileDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="icon" className="rounded-none">
          <Avatar size="sm">
            <AvatarFallback className="bg-muted text-muted-foreground text-xs font-semibold">
              AM
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="px-3">
          <div className="flex items-center gap-2 py-0.5">
            <Avatar size="sm" className="size-7">
              <AvatarFallback className="bg-muted text-[0.625rem] font-bold">
                AM
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">Alex Morgan</span>
              <span className="text-muted-foreground text-[0.625rem]">
                alex@personal-gmail.com
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

type SyncedState = "Not connected" | "No mail cached" | "Synced";

function MailTopNav({ syncedState }: { syncedState: SyncedState }) {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="border-border bg-card flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button
            type="button"
            className="border-border bg-accent flex min-w-40 cursor-default items-center gap-2 border px-2.5 py-1 text-sm font-semibold"
          >
            <span className="bg-destructive text-primary-foreground flex size-4 items-center justify-center text-[0.625rem] font-black">
              G
            </span>
            <span className="truncate">Personal Gmail</span>
            <svg
              className="ml-auto size-3 shrink-0 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuLabel className="px-3">
            <div className="flex items-center gap-2 py-0.5">
              <Avatar size="sm" className="size-7">
                <AvatarFallback className="bg-muted text-[0.625rem] font-bold">
                  AM
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">Alex Morgan</span>
                <span className="text-muted-foreground text-[0.625rem]">
                  alex@personal-gmail.com
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
          {syncedState}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="size-8"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </Button>

        <ProfileDropdown />

        <ThemeToggle />

        <SignOutButton className="hidden h-8 px-3 text-[0.55rem] tracking-widest uppercase lg:flex" />
      </div>
    </nav>
  );
}

function MailList({ items }: { items: MailListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="border-border bg-card flex min-w-0 flex-col border-r">
        <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            Priority First
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
            <p>No mail in your inbox yet. Hit Refresh to sync.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-card flex min-w-0 flex-col border-r">
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          Priority First
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Filter"
          className="border-border text-muted-foreground hover:bg-accent hover:text-foreground ml-auto flex size-7 items-center justify-center border transition"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
      </div>

      <div className="border-border bg-card flex h-9 shrink-0 border-b text-xs font-medium">
        <button
          type="button"
          className="border-primary text-foreground border-b-2 px-3.5"
        >
          Important
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground px-3.5 transition"
        >
          Unread
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground px-3.5 transition"
        >
          Calendar
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground px-3.5 transition"
        >
          All
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <Link
            key={item.id}
            href="/mail"
            className={[
              "border-border hover:bg-accent block border-b px-4 py-3 transition",
              item.unread ? "" : "bg-muted",
            ].join(" ")}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className={[
                  "size-1.5 shrink-0 rounded-full",
                  item.unread ? "bg-primary" : "bg-muted-foreground",
                ].join(" ")}
              />
              <span className="truncate text-sm font-semibold">
                {item.from || "(unknown sender)"}
              </span>
              <span className="text-muted-foreground shrink-0 text-[0.625rem]">
                {formatReceived(item.receivedAt)}
              </span>
            </div>
            <p className="truncate pl-3.5 text-xs font-medium">
              {item.subject || "(no subject)"}
            </p>
            <p className="text-muted-foreground truncate pl-3.5 text-[0.625rem]">
              {item.snippet}
            </p>
            {item.labelIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
                {item.labelIds
                  .filter(
                    (l) =>
                      ![
                        "UNREAD",
                        "IMPORTANT",
                        "CATEGORY_PERSONAL",
                        "CATEGORY_UPDATES",
                      ].includes(l),
                  )
                  .slice(0, 3)
                  .map((label) => (
                    <MailTag key={label}>
                      {label.replace(/^Label_/, "")}
                    </MailTag>
                  ))}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

function AssistantActionCard({
  children,
  title,
  description,
}: {
  children: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Button
      variant="ghost"
      className="bg-muted hover:border-border hover:bg-accent mb-2 flex h-auto w-full items-center gap-3 rounded-none border border-transparent px-4 py-3 text-left"
    >
      <div className="border-primary/30 bg-accent text-primary flex size-8 shrink-0 items-center justify-center border">
        {children}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-[0.625rem] leading-4">
          {description}
        </p>
      </div>
      <svg
        className="text-muted-foreground shrink-0"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Button>
  );
}

function MailViewer({
  gmailConnected,
  profile,
}: {
  gmailConnected: boolean;
  profile: MailListItem | null;
}) {
  const router = useRouter();

  if (!gmailConnected) {
    return (
      <main className="bg-background flex min-w-0 flex-col overflow-hidden">
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
                onClick={() => router.push("/mail?refresh=true")}
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
      <div className="border-border bg-card flex h-12 shrink-0 items-center gap-1 border-b px-4">
        <MailToolbarButton>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          Reply
        </MailToolbarButton>
        <div className="bg-border my-1 h-8 w-px" />
        <MailToolbarButton>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          Archive
        </MailToolbarButton>
        <MailToolbarButton>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Mark unread
        </MailToolbarButton>
        <MailToolbarButton>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          Label
        </MailToolbarButton>
        <MailToolbarButton>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Create event
        </MailToolbarButton>
        <div className="bg-border my-1 h-8 w-px" />
        <MailToolbarButton>
          <svg
            className="text-primary"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Ask AI
        </MailToolbarButton>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {profile ? (
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">
              {profile.from || "Inbox"}
            </Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              {profile.subject || "(no subject)"}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
              {formatReceived(profile.receivedAt)}
            </p>
            <p className="text-foreground mt-4 max-w-xl text-sm leading-relaxed">
              {profile.snippet}
            </p>
            <p className="text-muted-foreground mt-4 text-[0.625rem] tracking-[0.16em] uppercase">
              Select a thread from the list to read the full message.
            </p>
          </div>
        ) : (
          <div className="border-border bg-card flex min-h-full flex-col justify-center border p-6">
            <Badge variant="secondary" className="w-fit">
              Inbox
            </Badge>
            <h1 className="font-heading mt-4 text-2xl font-semibold tracking-widest uppercase">
              Select a thread
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
              Pick a conversation from the list on the left to read the full
              message.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function MailAssistant() {
  return (
    <aside className="border-border bg-card flex h-full min-w-0 flex-col border-l">
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <div className="text-primary">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
        <span className="flex-1 text-sm font-bold">Assistant</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-6">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" className="size-6">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto px-4 pt-3 pb-4">
        <p className="text-muted-foreground mb-2 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
          Suggested Actions
        </p>

        <AssistantActionCard
          title="Summarize thread"
          description="Get a concise summary of this conversation."
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard
          title="Schedule follow-up"
          description="Find time and propose a follow-up."
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard
          title="Draft reply"
          description="Generate a reply based on this thread."
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard
          title="Find related events"
          description="Show events related to this conversation."
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </AssistantActionCard>
      </div>

      <div className="border-border text-muted-foreground border-t px-4 py-3 text-center text-[0.625rem]">
        AI can make mistakes. Check important info.
      </div>
    </aside>
  );
}

export function MailInterface({ initial }: { initial: MailPageData }) {
  const listItems: MailListItem[] = initial.gmailConnected
    ? initial.list.items
    : [];
  const syncedState: SyncedState = !initial.gmailConnected
    ? "Not connected"
    : initial.list.items.length === 0
      ? "No mail cached"
      : "Synced";
  const preview = listItems[0] ?? null;

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <MailTopNav syncedState={syncedState} />
      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel>
          <MailSidebar gmailConnected={initial.gmailConnected} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <MailList items={listItems} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <MailViewer
            gmailConnected={initial.gmailConnected}
            profile={preview}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
