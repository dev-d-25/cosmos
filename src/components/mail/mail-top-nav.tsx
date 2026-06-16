"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { CommandIcon } from "lucide-react";
import { ProfileDropdown } from "./profile-dropdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/auth-buttons";
import type { MailSyncedState as SyncedState } from "@/types/mail";

export function MailTopNav({
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
