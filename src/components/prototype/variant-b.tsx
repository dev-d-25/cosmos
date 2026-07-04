"use client";

import { useState } from "react";
import { MailSidebar } from "@/components/mail/sidebar";
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
  ChevronDown,
  Mail,
  Calendar,
  Bot,
} from "lucide-react";

/**
 * PROTOTYPE — Variant B: Agent-First Shell.
 * New tab order, floating chat widget, sidebar with Queue + Memory.
 * Delete this file when done.
 */

// ─── New Top Nav (Agent → Mail → Calendar) ──────────────────────────────────
function AgentFirstNav({
  syncedState,
  profile,
  onRefresh,
  onSearchOpen,
}: Record<string, any>) {
  return (
    <div className="border-border flex h-12 items-center border-b px-4">
      {/* Tab Navigation — Agent first */}
      <div className="flex items-center gap-1">
        <a
          href="/agent"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-orange-500"
        >
          <Bot className="h-4 w-4" />
          Agent
        </a>
        <a
          href="/mail"
          className="bg-muted flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
        >
          <Mail className="h-4 w-4" />
          Mail
        </a>
        <a
          href="/calendar"
          className="text-muted-foreground hover:bg-muted flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Calendar
        </a>
      </div>

      {/* Search */}
      <div className="ml-8 flex-1">
        <button
          onClick={onSearchOpen}
          className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
        >
          <span className="text-xs">🔍</span>
          Search mail, events, people, or ask AI...
          <kbd className="bg-muted text-muted-foreground ml-4 rounded border px-1.5 py-0.5 text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-green-500">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {syncedState}
        </span>
        <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground text-sm" title="Refresh">
          🔄
        </button>
        <button className="text-muted-foreground hover:text-foreground text-sm" title="Shortcuts">
          ⌨️
        </button>
        <div className="flex items-center gap-2">
          {profile?.picture && (
            <img src={profile.picture} alt="" className="h-6 w-6 rounded-full" />
          )}
          <span className="text-xs">{profile?.emailAddress ?? "User"}</span>
        </div>
      </div>
    </div>
  );
}

// ─── New Sidebar (with Queue + Memory) ──────────────────────────────────────
function AgentFirstSidebar({
  activeLabel,
  onCompose,
  labels,
}: Record<string, any>) {
  const [queueCount] = useState(3); // PROTOTYPE — stub

  return (
    <div className="flex h-full flex-col border-r">
      {/* Compose */}
      <div className="p-3">
        <button
          onClick={onCompose}
          className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors hover:opacity-90"
        >
          ✏️ Compose
        </button>
      </div>

      {/* Core labels */}
      <nav className="flex-1 space-y-0.5 px-2">
        <SidebarItem icon={<Inbox className="h-4 w-4" />} label="Inbox" count={122} active={activeLabel === "INBOX"} />
        <SidebarItem icon={<Star className="h-4 w-4" />} label="Starred" active={activeLabel === "STARRED"} />
        <SidebarItem icon={<Send className="h-4 w-4" />} label="Sent" active={activeLabel === "SENT"} />
        <SidebarItem icon={<FileText className="h-4 w-4" />} label="Drafts" active={activeLabel === "DRAFTS"} />
        <SidebarItem icon={<Archive className="h-4 w-4" />} label="Archive" active={activeLabel === "ARCHIVE"} />

        {/* Divider */}
        <div className="border-border my-2 border-t" />

        {/* Queue — NEW */}
        <SidebarItem
          icon={<Clock className="h-4 w-4 text-orange-500" />}
          label="Queue"
          count={queueCount}
          badge
          active={false}
        />

        {/* Memory — NEW */}
        <SidebarItem
          icon={<Brain className="h-4 w-4 text-purple-500" />}
          label="Memory"
          active={false}
        />

        {/* Divider */}
        <div className="border-border my-2 border-t" />

        {/* Reduced labels — only important ones */}
        <SidebarItem icon={<Inbox className="h-4 w-4" />} label="Important" count={58} active={activeLabel === "IMPORTANT"} />
        <SidebarItem icon={<Mail className="h-4 w-4" />} label="Unread" count={2419} active={activeLabel === "UNREAD"} />
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <div className="text-muted-foreground text-[10px]">
          PROTOTYPE — Variant B sidebar
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  count,
  badge,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-muted font-medium"
          : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            "text-[11px]",
            badge
              ? "bg-orange-500/20 text-orange-500 rounded-full px-1.5 py-0.5 font-medium"
              : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Floating Chat Widget ───────────────────────────────────────────────────
function FloatingChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "fixed bottom-20 right-6 z-[9998] flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
          open
            ? "bg-muted text-foreground"
            : "bg-orange-500 text-white hover:bg-orange-600",
        )}
      >
        {open ? (
          <span className="text-xl">✕</span>
        ) : (
          <MessageSquare className="h-6 w-6" />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="bg-background border-border fixed bottom-36 right-6 z-[9998] flex w-80 flex-col rounded-xl border shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b p-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-sm font-semibold">Cosmos Agent</div>
                <div className="text-muted-foreground text-[10px]">Powered by AI</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground text-xs">
              ✕
            </button>
          </div>

          {/* Messages */}
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

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Ask me anything..."
                className="bg-muted flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <button className="bg-orange-500 rounded-lg px-3 py-2 text-sm text-white">
                ➤
              </button>
            </div>
            <div className="text-muted-foreground mt-1 text-center text-[10px]">
              AI-generated content may be inaccurate.
            </div>
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

// ─── Main Variant B ─────────────────────────────────────────────────────────
export function VariantB({
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
      <div className="bg-orange-500/10 text-orange-500 flex items-center justify-center py-1 text-xs font-medium">
        Variant B — Agent-First Shell + Floating Widget + Queue/Memory Sidebar
      </div>

      <AgentFirstNav
        syncedState={syncedState}
        profile={profile}
        onRefresh={onRefresh}
        onSearchOpen={onSearchOpen}
      />

      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={12}>
          <AgentFirstSidebar
            activeLabel={activeLabel}
            onCompose={onCompose}
            labels={labels}
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
