"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useTheme } from "next-themes"

import { SignOutButton } from "@/components/auth-buttons"
import { ConnectButton } from "@/components/connect-button"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ThemeToggle } from "@/components/theme-toggle"

function MailToolbarButton({ children }: { children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon-xs" className="min-w-[54px] flex flex-col gap-0.5 border border-transparent px-2.5 py-1 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </Button>
  )
}

function SidebarItem({
  active = false,
  badge,
  children,
}: {
  active?: boolean
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Link
      href="/mail"
      className={[
        "flex items-center gap-2.5 px-4 py-1.5 text-xs font-medium text-sidebar-foreground transition hover:bg-sidebar-accent",
        active ? "bg-sidebar-accent text-sidebar-primary" : "",
      ].join(" ")}
    >
      {children}
      {badge ? <span className="ml-auto rounded-none bg-primary px-2 py-0.5 text-[0.625rem] font-semibold text-primary-foreground">{badge}</span> : null}
    </Link>
  )
}

function MailTag({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="h-4 px-1.5 text-[0.55rem] font-semibold uppercase tracking-wide">
      {children}
    </Badge>
  )
}

function MailSidebar({ gmailConnected }: { gmailConnected: boolean }) {
  return (
    <aside className="flex h-full flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-0">
      <SidebarItem active badge="12">
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
        Inbox
      </SidebarItem>
      <SidebarItem badge="8">
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Priority
      </SidebarItem>
      <SidebarItem badge="3">
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Needs Reply
      </SidebarItem>
      <SidebarItem>
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Starred
      </SidebarItem>
      <SidebarItem>
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        Sent
      </SidebarItem>
      <SidebarItem badge="2">
        <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        Drafts
      </SidebarItem>
      <SidebarItem>Archive</SidebarItem>
      <SidebarItem>Spam</SidebarItem>

      <div className="my-2 h-px bg-border" />

      <div className="flex items-center justify-between px-4 pb-1 pt-4 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Labels
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <SidebarItem badge="6">
        <span className="size-2 bg-primary" />
        Work
      </SidebarItem>
      <SidebarItem badge="4">
        <span className="size-2 bg-primary" />
        Personal
      </SidebarItem>
      <SidebarItem badge="2">
        <span className="size-2 bg-primary" />
        Finance
      </SidebarItem>
      <SidebarItem badge="1">
        <span className="size-2 bg-primary" />
        Travel
      </SidebarItem>

      <div className="my-2 h-px bg-border" />

      <div className="px-4 pb-1 pt-4">
        <div className="mb-2 flex items-center justify-between text-[0.55rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Today
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="flex gap-2.5 py-1">
          <span className="min-w-9 text-[0.625rem] text-muted-foreground">9:00</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Standup</p>
            <p className="truncate text-[0.625rem] text-muted-foreground">30m, Google Meet</p>
          </div>
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
        </div>
        <div className="flex gap-2.5 py-1">
          <span className="min-w-9 text-[0.625rem] text-muted-foreground">14:30</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Product Review</p>
            <p className="truncate text-[0.625rem] text-muted-foreground">1h, Room 3 / Zoom</p>
          </div>
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
        </div>
      </div>

      <div className="my-2 h-px bg-border" />

      <div className="px-4 pb-4 pt-3">
        <p className="mb-2 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Connected Accounts
        </p>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-sm bg-destructive text-[0.55rem] font-black text-primary-foreground">G</span>
          Gmail
          <span className="ml-auto flex items-center gap-1 text-[0.625rem]">
            <span className={["size-1.5 rounded-full", gmailConnected ? "bg-primary" : "bg-muted-foreground"].join(" ")} />
            {gmailConnected ? "Connected" : "Missing"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-sm bg-primary text-[0.55rem] font-black text-primary-foreground">C</span>
          Google Calendar
          <span className="ml-auto flex items-center gap-1 text-[0.625rem]">
            <span className="size-1.5 rounded-full bg-primary" />
            Connected
          </span>
        </div>
      </div>
    </aside>
  )
}

function ProfileDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="icon" className="rounded-none">
          <Avatar size="sm">
            <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
              AM
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="px-3">
          <div className="flex items-center gap-2 py-0.5">
            <Avatar size="sm" className="size-7">
              <AvatarFallback className="bg-muted text-[0.625rem] font-bold">AM</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">Alex Morgan</span>
              <span className="text-[0.625rem] text-muted-foreground">alex@personal-gmail.com</span>
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
  )
}

function MailTopNav() {
  const { theme, setTheme } = useTheme()

  return (
    <nav className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button
            type="button"
            className="flex min-w-40 cursor-default items-center gap-2 border border-border bg-accent px-2.5 py-1 text-sm font-semibold"
          >
            <span className="flex size-4 items-center justify-center bg-destructive text-[0.625rem] font-black text-primary-foreground">
              G
            </span>
            <span className="truncate">Personal Gmail</span>
            <svg className="ml-auto size-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuLabel className="px-3">
            <div className="flex items-center gap-2 py-0.5">
              <Avatar size="sm" className="size-7">
                <AvatarFallback className="bg-muted text-[0.625rem] font-bold">AM</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">Alex Morgan</span>
                <span className="text-[0.625rem] text-muted-foreground">alex@personal-gmail.com</span>
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
        <Link href="/mail" className={buttonVariants({ variant: "ghost", size: "sm" })}>Mail</Link>
        <Link href="/calendar" className={buttonVariants({ variant: "ghost", size: "sm" })}>Calendar</Link>
        <Link href="/agent" className={buttonVariants({ variant: "ghost", size: "sm" })}>Agent</Link>
      </div>

      <div className="relative min-w-0 flex-1">
        <svg className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="h-8 w-full rounded-none border border-border bg-muted px-3 pl-8 pr-14 text-xs text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search mail, events, people, or ask AI..."
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          <Kbd className="text-[0.625rem]">Cmd K</Kbd>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="hidden items-center gap-1.5 px-2.5 py-1 text-xs lg:inline-flex">
          <span className="size-1.5 rounded-full bg-primary" />
          Synced
        </Badge>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="size-8">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </Button>

        <ProfileDropdown />

        <ThemeToggle />

        <SignOutButton className="hidden lg:flex h-8 px-3 text-[0.55rem] uppercase tracking-widest" />
      </div>
    </nav>
  )
}

function MailList() {
  return (
    <div className="flex min-w-0 flex-col border-r border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <button type="button" className="flex items-center gap-1.5 text-sm font-semibold">
          Priority First
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button type="button" aria-label="Filter" className="ml-auto flex size-7 items-center justify-center border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
      </div>

      <div className="flex h-9 shrink-0 border-b border-border bg-card text-xs font-medium">
        <button type="button" className="border-b-2 border-primary px-3.5 text-foreground">Important</button>
        <button type="button" className="px-3.5 text-muted-foreground transition hover:text-foreground">Unread</button>
        <button type="button" className="px-3.5 text-muted-foreground transition hover:text-foreground">Calendar</button>
        <button type="button" className="px-3.5 text-muted-foreground transition hover:text-foreground">All</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Link href="/mail" className="block border-b border-border bg-muted px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate text-sm font-semibold">Alex Morgan</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">10:24</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">Contract update and next meeting</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">
            Hey team, I&apos;ve updated the contract based on our latest discussion. Can we also...
          </p>
          <div className="mt-1 flex gap-1 pl-3.5">
            <MailTag>Work</MailTag>
          </div>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate text-sm font-semibold">Nina Patel</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">09:41</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">Calendar invite: Demo review</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">
            You&apos;re invited to Demo review on Thursday, May 22, 2025 2:00 PM...
          </p>
          <div className="mt-1 flex items-center gap-1 pl-3.5">
            <MailTag>Work</MailTag>
            <span className="flex size-4 items-center justify-center border border-border bg-accent text-muted-foreground">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
          </div>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate text-sm font-semibold">Stripe</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">Yesterday</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">Invoice for May</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">Your invoice for May is ready to view and pay.</p>
          <div className="mt-1 flex gap-1 pl-3.5">
            <MailTag>Finance</MailTag>
          </div>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate text-sm font-semibold">Corsair Team</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">Yesterday</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">OAuth webhook setup</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">
            Follow the steps below to configure webhooks for your OAuth application.
          </p>
          <div className="mt-1 flex gap-1 pl-3.5">
            <MailTag>Work</MailTag>
          </div>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate text-sm font-semibold">Notion Team</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">May 19</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">What&apos;s new in Notion AI</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">New features to help you write, plan, and ship faster.</p>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate text-sm font-semibold">Lufthansa</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">May 18</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">Your booking confirmation</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">Your booking to Berlin (LH 247) is confirmed.</p>
          <div className="mt-1 flex gap-1 pl-3.5">
            <MailTag>Travel</MailTag>
          </div>
        </Link>

        <Link href="/mail" className="block border-b border-border px-4 py-3 transition hover:bg-accent">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate text-sm font-semibold">GitHub</span>
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">May 17</span>
          </div>
          <p className="truncate pl-3.5 text-xs font-medium">Security alert</p>
          <p className="truncate pl-3.5 text-[0.625rem] text-muted-foreground">We detected a new sign-in to your account.</p>
        </Link>
      </div>
    </div>
  )
}

function AssistantActionCard({
  children,
  title,
  description,
}: {
  children: ReactNode
  title: string
  description: string
}) {
  return (
    <Button variant="ghost" className="mb-2 flex h-auto w-full items-center gap-3 rounded-none border border-transparent bg-muted px-4 py-3 text-left hover:border-border hover:bg-accent">
      <div className="flex size-8 shrink-0 items-center justify-center border border-primary/30 bg-accent text-primary">
        {children}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[0.625rem] leading-4 text-muted-foreground">{description}</p>
      </div>
      <svg className="shrink-0 text-muted-foreground" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Button>
  )
}

function MailViewer({ gmailConnected }: { gmailConnected: boolean }) {
  return (
    <main className="flex min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-4">
        <MailToolbarButton>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          Reply
        </MailToolbarButton>
        <div className="my-1 h-8 w-px bg-border" />
        <MailToolbarButton>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          Archive
        </MailToolbarButton>
        <MailToolbarButton>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Mark unread
        </MailToolbarButton>
        <MailToolbarButton>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          Label
        </MailToolbarButton>
        <MailToolbarButton>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Create event
        </MailToolbarButton>
        <div className="my-1 h-8 w-px bg-border" />
        <MailToolbarButton>
          <svg className="text-primary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Ask AI
        </MailToolbarButton>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {gmailConnected ? (
          <>
            <div className="mb-5 flex items-center gap-2">
              <h1 className="flex-1 text-base font-bold">Contract update and next meeting</h1>
              <Badge variant="secondary" className="h-5 px-2 text-[0.55rem] font-semibold uppercase tracking-wide">
                Work
              </Badge>
              <Button variant="ghost" size="icon" aria-label="Star" className="size-7 text-muted-foreground">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </Button>
              <Button variant="ghost" size="icon" aria-label="More actions" className="size-7 text-muted-foreground">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </Button>
            </div>

            <div className="mb-6 flex items-start gap-3 border-b border-border pb-5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                AM
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Alex Morgan</p>
                <p className="text-xs text-muted-foreground">to me, Sarah Lee, David Kim</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Today, 10:24 AM</span>
                <Button variant="ghost" size="icon" aria-label="Reply" className="size-7 border border-border">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                </Button>
                <Button variant="ghost" size="icon" aria-label="Forward" className="size-7 border border-border">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </Button>
              </div>
            </div>

            <div className="mb-6 text-sm leading-relaxed">
              <p className="mb-3">Hi team,</p>
              <p className="mb-3">
                I&apos;ve updated the contract based on our latest discussion. The main changes include the revised payment terms and the new SLA section.
              </p>
              <p className="mb-3">
                Please review the attached document and let me know if you have any questions or feedback.
              </p>
              <p className="mb-3">
                Also, I&apos;d like to schedule a quick sync to align on next steps. Does Thursday morning work for everyone?
              </p>
              <p>
                Thanks,
                <br />
                Alex
              </p>
            </div>

            <div className="mb-5 flex items-center gap-3 border border-border bg-card p-4">
              <div className="flex size-9 shrink-0 items-center justify-center border border-primary/40 bg-primary/20 text-[0.55rem] font-black text-primary">
                PDF
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Contract_v2.pdf</p>
                <p className="text-[0.625rem] text-muted-foreground">328 KB</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Download" className="size-7">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </Button>
              <Button variant="ghost" size="icon" aria-label="Open in new tab" className="size-7">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Button>
            </div>

            <div className="mb-5 border border-border bg-card p-4">
              <div className="flex gap-3">
                <div className="flex size-7 shrink-0 items-center justify-center text-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1 pr-8">
                  <p className="text-sm font-semibold">This thread mentions a meeting.</p>
                  <p className="text-xs text-muted-foreground">Create a calendar event?</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="xs">Create event</Button>
                    <Button size="xs" variant="outline">Draft reply</Button>
                    <Button size="xs" variant="outline">Dismiss</Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-full flex-col justify-center border border-border bg-card p-6">
            <Badge variant="secondary" className="w-fit">Gmail required</Badge>
            <h1 className="mt-4 font-heading text-2xl font-semibold uppercase tracking-widest">Connect Gmail</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Connect your Gmail with Corsair to unlock the Cosmos Mail interface. We will use your Better Auth tenant ID to attach this Gmail account to your workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ConnectButton plugin="gmail" />
              <Link href="/mail" className={buttonVariants({ variant: "outline" })}>Refresh status</Link>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function MailAssistant() {
  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="text-primary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
        <span className="flex-1 text-sm font-bold">Assistant</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-6">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" className="size-6">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto px-4 pb-4 pt-3">
        <p className="mb-2 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Suggested Actions
        </p>

        <AssistantActionCard title="Summarize thread" description="Get a concise summary of this conversation.">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard title="Schedule follow-up" description="Find time and propose a follow-up.">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard title="Draft reply" description="Generate a reply based on this thread.">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </AssistantActionCard>
        <AssistantActionCard title="Find related events" description="Show events related to this conversation.">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </AssistantActionCard>
      </div>

      <div className="border-t border-border px-4 py-3 text-center text-[0.625rem] text-muted-foreground">
        AI can make mistakes. Check important info.
      </div>
    </aside>
  )
}

function MailInterface() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <MailTopNav />
      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel>
          <MailSidebar gmailConnected={true} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <MailList />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <MailViewer gmailConnected={true} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export default function MailPage() {
  return <MailInterface />
}
