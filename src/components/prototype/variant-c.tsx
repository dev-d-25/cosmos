"use client";

import { useState } from "react";
import { MailList } from "@/components/mail/mail-list";
import { MailViewer } from "@/components/mail/mail-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ComposeDialog } from "@/components/compose-dialog";
import { PAGE_SIZE } from "@/server/mail/schemas";
import type { MailLabel, MailListItem, MailProfile } from "@/server/mail/schemas";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Clock,
  Brain,
  Bot,
  Mail,
  Calendar,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  CalendarClock,
} from "lucide-react";

/**
 * PROTOTYPE — Variant C: Daily Brief + Widget.
 * Same as B but with a summary panel at the top showing today's brief.
 * Delete this file when done.
 */

// ─── Daily Brief Panel ──────────────────────────────────────────────────────
function DailyBriefPanel() {
  return (
    <div className="border-b bg-gradient-to-r from-orange-500/5 via-transparent to-purple-500/5">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500/10 flex h-8 w-8 items-center justify-center rounded-lg">
            <TrendingUp className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Good afternoon, Dev</h2>
            <p className="text-muted-foreground text-xs">
              Here&apos;s what&apos;s happening today
            </p>
          </div>
        </div>
        <button className="text-muted-foreground hover:text-foreground text-xs transition-colors">
          Dismiss
        </button>
      </div>

      {/* Brief cards */}
      <div className="flex gap-3 px-4 pb-3">
        <BriefCard
          icon={<Mail className="h-4 w-4 text-blue-500" />}
          title="3 unread emails"
          subtitle="2 from Naukri, 1 from HR"
          action="View"
        />
        <BriefCard
          icon={<CalendarClock className="h-4 w-4 text-green-500" />}
          title="2 meetings today"
          subtitle="Team standup at 3pm, Code review at 5pm"
          action="Calendar"
        />
        <BriefCard
          icon={<Clock className="h-4 w-4 text-orange-500" />}
          title="3 items in queue"
          subtitle="Draft email, Meeting invite, Follow-up"
          action="Queue"
        />
        <BriefCard
          icon={<AlertCircle className="h-4 w-4 text-red-500" />}
          title="1 action needed"
          subtitle="Reply to project allocation email"
          action="Reply"
        />
      </div>
    </div>
  );
}

function BriefCard({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action: string;
}) {
  return (
    <div className="bg-background flex flex-1 items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </div>
      <button className="text-muted-foreground hover:text-foreground flex-shrink-0 text-xs font-medium transition-colors">
        {action} →
      </button>
    </div>
  );
}

// ─── Same nav as Variant B ──────────────────────────────────────────────────
function AgentFirstNav({
  syncedState,
  profile,
  onRefresh,
  onSearchOpen,
}: Record<string, any>) {
  return (
    <div className="border-border flex h-12 items-center border-b px-4">
      <div className="flex items-center gap-1">
        <a href="/agent" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-orange-500">
          <Bot className="h-4 w-4" />
          Agent
        </a>
        <a href="/mail" className="bg-muted flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium">
          <Mail className="h-4 w-4" />
          Mail
        </a>
        <a href="/calendar" className="text-muted-foreground hover:bg-muted flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors">
          <Calendar className="h-4 w-4" />
          Calendar
        </a>
      </div>
      <div className="ml-8 flex-1">
        <button onClick={onSearchOpen} className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors">
          <span className="text-xs">🔍</span>
          Search mail, events, people, or ask AI...
          <kbd className="bg-muted text-muted-foreground ml-4 rounded border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-green-500">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {syncedState}
        </span>
        <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground text-sm" title="Refresh">🔄</button>
        <button className="text-muted-foreground hover:text-foreground text-sm" title="Shortcuts">⌨️</button>
        <div className="flex items-center gap-2">
          {profile?.picture && <img src={profile.picture} alt="" className="h-6 w-6 rounded-full" />}
          <span className="text-xs">{profile?.emailAddress ?? "User"}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Same sidebar as Variant B ──────────────────────────────────────────────
function AgentFirstSidebar({ activeLabel, onCompose }: Record<string, any>) {
  const [queueCount] = useState(3);

  return (
    <div className="flex h-full flex-col border-r">
      <div className="p-3">
        <button onClick={onCompose} className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors hover:opacity-90">
          ✏️ Compose
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        <SidebarItem icon={<Inbox className="h-4 w-4" />} label="Inbox" count={122} active={activeLabel === "INBOX"} />
        <SidebarItem icon={<Star className="h-4 w-4" />} label="Starred" active={activeLabel === "STARRED"} />
        <SidebarItem icon={<Send className="h-4 w-4" />} label="Sent" active={activeLabel === "SENT"} />
        <SidebarItem icon={<FileText className="h-4 w-4" />} label="Drafts" active={activeLabel === "DRAFTS"} />
        <SidebarItem icon={<Archive className="h-4 w-4" />} label="Archive" active={activeLabel === "ARCHIVE"} />
        <div className="border-border my-2 border-t" />
        <SidebarItem icon={<Clock className="h-4 w-4 text-orange-500" />} label="Queue" count={queueCount} badge active={false} />
        <SidebarItem icon={<Brain className="h-4 w-4 text-purple-500" />} label="Memory" active={false} />
        <div className="border-border my-2 border-t" />
        <SidebarItem icon={<Inbox className="h-4 w-4" />} label="Important" count={58} active={activeLabel === "IMPORTANT"} />
        <SidebarItem icon={<Mail className="h-4 w-4" />} label="Unread" count={2419} active={activeLabel === "UNREAD"} />
      </nav>
      <div className="border-t p-3">
        <div className="text-muted-foreground text-[10px]">PROTOTYPE — Variant C sidebar</div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, count, badge, active }: { icon: React.ReactNode; label: string; count?: number; badge?: boolean; active?: boolean }) {
  return (
    <button className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}>
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && (
        <span className={cn("text-[11px]", badge ? "bg-orange-500/20 text-orange-500 rounded-full px-1.5 py-0.5 font-medium" : "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Floating Chat Widget (same as B) ───────────────────────────────────────
function FloatingChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "fixed bottom-20 right-6 z-[9998] flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
          open ? "bg-muted text-foreground" : "bg-orange-500 text-white hover:bg-orange-600",
        )}
      >
        {open ? <span className="text-xl">✕</span> : <MessageSquare className="h-6 w-6" />}
      </button>

      {open && (
        <div className="bg-background border-border fixed bottom-36 right-6 z-[9998] flex w-80 flex-col rounded-xl border shadow-2xl">
          <div className="flex items-center justify-between border-b p-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-sm font-semibold">Cosmos Agent</div>
                <div className="text-muted-foreground text-[10px]">Powered by AI</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground text-xs">✕</button>
          </div>
          <div className="flex-1 p-3" style={{ minHeight: 200, maxHeight: 300 }}>
            <div className="bg-muted mb-3 rounded-lg p-3 text-sm">
              👋 Hi! I can help you with your emails and calendar. What would you like to do?
            </div>
            <div className="flex flex-wrap gap-2">
              <QuickAction label="📅 Summarize today" />
              <QuickAction label="✉️ Draft a reply" />
              <QuickAction label="🔍 Find important emails" />
              <QuickAction label="📋 Show my queue" />
            </div>
          </div>
          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Ask me anything..." className="bg-muted flex-1 rounded-lg px-3 py-2 text-sm outline-none" />
              <button className="bg-orange-500 rounded-lg px-3 py-2 text-sm text-white">➤</button>
            </div>
            <div className="text-muted-foreground mt-1 text-center text-[10px]">AI-generated content may be inaccurate.</div>
          </div>
        </div>
      )}
    </>
  );
}

function QuickAction({ label }: { label: string }) {
  return (
    <button className="bg-background border-border hover:bg-muted rounded-full border px-3 py-1.5 text-xs transition-colors">
      {label}
    </button>
  );
}

// ─── Main Variant C ─────────────────────────────────────────────────────────
export function VariantC({
  syncedState,
  profile,
  onRefresh,
  onClearCache,
  isRefreshing,
  isClearing,
  onSearchOpen,
  shortcutsOpen,
  onShortcutsOpenChange,
  labels,
  activeLabel,
  onCompose,
  items,
  selectedId,
  onSelect,
  onOpen,
  page,
  totalPages,
  hasMore,
  hasPrev,
  count,
  cacheState,
  coverage,
  degraded,
  source,
  onPageChange,
  loading,
  isInitialLoading,
  labelName,
  searchQuery,
  onClearSearch,
  gmailConnected,
  selectedListItem,
  message,
  messageSource,
  messageLoading,
  messageError,
  onRetryMessage,
  onCloseMessage,
  onAction,
  composeOpen,
  setComposeOpen,
}: Record<string, any>) {
  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      {/* PROTOTYPE BADGE */}
      <div className="bg-purple-500/10 text-purple-500 flex items-center justify-center py-1 text-xs font-medium">
        Variant C — Daily Brief + Agent-First Shell + Floating Widget
      </div>

      <AgentFirstNav
        syncedState={syncedState}
        profile={profile}
        onRefresh={onRefresh}
        onSearchOpen={onSearchOpen}
      />

      {/* Daily Brief Panel */}
      <DailyBriefPanel />

      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={12}>
          <AgentFirstSidebar
            activeLabel={activeLabel}
            onCompose={onCompose}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className={`relative flex min-w-0 flex-col ${loading ? "pointer-events-none opacity-70" : ""}`}>
            <MailList
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              page={page}
              totalPages={totalPages}
              hasMore={hasMore}
              hasPrev={hasPrev}
              pageSize={PAGE_SIZE}
              count={count}
              cacheState={cacheState}
              coverage={coverage}
              degraded={degraded}
              source={source}
              onPageChange={onPageChange}
              loading={loading}
              error={null}
              isInitialLoading={isInitialLoading}
              labelName={labelName}
              searchQuery={searchQuery}
              onClearSearch={onClearSearch}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={54} minSize={30}>
          <MailViewer
            gmailConnected={gmailConnected}
            selectedListItem={selectedListItem}
            message={message}
            messageSource={messageSource}
            messageLoading={messageLoading}
            messageError={messageError}
            onRetryMessage={onRetryMessage}
            onCloseMessage={onCloseMessage}
            onAction={onAction}
            labelName={labelName}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <FloatingChatWidget />
      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
