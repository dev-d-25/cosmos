"use client";

import { MailTopNav } from "@/components/mail/mail-top-nav";
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
import type { MailSyncedState as SyncedState } from "@/types/mail";

/**
 * PROTOTYPE — Variant A: Current Layout (baseline).
 * This is the existing 3-panel mail layout with old tabs.
 * Delete this file when done.
 */
export function VariantA({
  // Layout props
  syncedState,
  profile,
  onRefresh,
  onClearCache,
  isRefreshing,
  isClearing,
  onSearchOpen,
  shortcutsOpen,
  onShortcutsOpenChange,
  // Sidebar props
  labels,
  activeLabel,
  onCompose,
  // List props
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
  // Viewer props
  gmailConnected,
  selectedListItem,
  message,
  messageSource,
  messageLoading,
  messageError,
  onRetryMessage,
  onCloseMessage,
  onAction,
  // Compose
  composeOpen,
  setComposeOpen,
}: Record<string, any>) {
  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      {/* PROTOTYPE BADGE */}
      <div className="bg-muted text-muted-foreground flex items-center justify-center py-1 text-xs font-medium">
        Variant A — Current Layout (baseline)
      </div>

      <MailTopNav
        syncedState={syncedState}
        profile={profile}
        onRefresh={onRefresh}
        onClearCache={onClearCache}
        isRefreshing={isRefreshing}
        isClearing={isClearing}
        onSearchOpen={onSearchOpen}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={onShortcutsOpenChange}
      />

      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={12}>
          <MailSidebar
            labels={labels}
            activeLabel={activeLabel}
            profile={profile}
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

      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
