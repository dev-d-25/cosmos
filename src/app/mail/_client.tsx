"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ComposeDialog } from "@/components/compose-dialog";
import { useMailShortcuts } from "@/hooks/use-mail-shortcuts";
import { MailTopNav } from "@/components/mail/mail-top-nav";
import { MailSidebar } from "@/components/mail/sidebar";
import { MailList } from "@/components/mail/mail-list";
import { MailViewer } from "@/components/mail/mail-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { MailPageData } from "@/server/mail/schemas";
import { PAGE_SIZE } from "@/server/mail/schemas";
import { markAsReadLocally } from "@/lib/read-emails";
import { MAIL_LABELS } from "@/lib/mail/labels";

import { useMailNav } from "@/hooks/use-mail-nav";
import { useMailActions } from "@/hooks/use-mail-actions";
import { useMailViewModel } from "@/components/mail/mail-view-model";
import { useMailPrefetch } from "@/hooks/use-mail-prefetch";

export function MailInterface({
  initial,
  initialLabel,
}: {
  initial: MailPageData;
  initialLabel: string;
}) {
  const gmailConnected = initial.gmailConnected;
  const router = useRouter();

  const nav = useMailNav({ initialLabel });
  const actions = useMailActions({
    activeLabel: nav.activeLabel,
    page: nav.page,
    navigate: nav.navigate,
  });
  const vm = useMailViewModel({
    initial: initial.gmailConnected ? initial.list : { items: [], count: 0, page: 1, totalPages: null, hasMore: false, hasPrev: false, cacheState: "empty", coverage: 0, source: "cache", degraded: false },
    initialLabel,
    page: nav.page,
    selectedId: nav.selectedId,
    searchQuery: nav.searchQuery,
    gmailParams: nav.gmailParams,
    activeLabel: nav.activeLabel,
    gmailConnected,
  });

  useMailPrefetch({ page: nav.page, hasMore: vm.hasMore, gmailParams: nav.gmailParams });

  const labelDef = MAIL_LABELS.find((l) => l.id === nav.activeLabel);
  const labelName = labelDef?.name ?? nav.activeLabel;

  const [composeOpen, setComposeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const handleShortcut = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    },
    [router],
  );
  useEffect(() => {
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [handleShortcut]);

  const onSelect = (id: string) => { markAsReadLocally(id); nav.navigate({ id }); };
  const onOpen = (id: string) => nav.navigate({ id });
  const onClose = () => nav.navigate({ id: null });
  const onPageChange = (newPage: number) => nav.navigate({ page: newPage > 1 ? String(newPage) : null });
  const setSearchQuery = (q: string) => nav.navigate(q ? { q, page: null, label: null } : { q: null, page: null });

  useMailShortcuts({
    items: vm.items,
    selectedId: nav.selectedId,
    setSelectedId: (valueOrUpdater) => {
      const nextId = typeof valueOrUpdater === "function" ? valueOrUpdater(nav.selectedId) : valueOrUpdater;
      nav.navigate({ id: nextId });
    },
    onOpen,
    onClose,
    onMailAction: actions.onMailAction,
    navigate: (url: string) => router.push(url),
    composeOpen,
    shortcutsOpen,
    setShortcutsOpen,
  });

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <MailTopNav
        syncedState={vm.syncedState}
        profile={vm.profile}
        onRefresh={actions.onRefresh}
        onClearCache={actions.onClearCache}
        isRefreshing={actions.refreshMutation.isPending}
        isClearing={actions.clearCacheMutation.isPending}
        onSearchOpen={() => router.push("/search")}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={setShortcutsOpen}
      />
      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={12}>
          <MailSidebar
            labels={vm.labels}
            activeLabel={nav.activeLabel}
            profile={vm.profile}
            onCompose={() => setComposeOpen(true)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className={cn("relative flex min-w-0 flex-col", vm.threadsQuery.isFetching && "pointer-events-none opacity-70")}>
            <MailList
              items={vm.items}
              selectedId={nav.selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              page={vm.pageFromResponse}
              totalPages={vm.totalPages}
              hasMore={vm.hasMore}
              hasPrev={vm.hasPrev}
              pageSize={PAGE_SIZE}
              count={vm.count}
              cacheState={vm.cacheState}
              coverage={vm.coverage}
              degraded={vm.degraded}
              source={vm.source}
              onPageChange={onPageChange}
              loading={vm.threadsQuery.isFetching}
              error={null}
              isInitialLoading={vm.threadsQuery.isLoading}
              labelName={labelName}
              searchQuery={nav.searchQuery || undefined}
              onClearSearch={() => setSearchQuery("")}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={54} minSize={30}>
          <MailViewer
            gmailConnected={gmailConnected}
            selectedListItem={vm.selectedListItem}
            message={vm.messageQuery.data?.message ?? null}
            messageSource={vm.messageQuery.data?.source ?? null}
            messageLoading={vm.messageQuery.isLoading}
            messageError={vm.messageQuery.error?.message ?? null}
            onRetryMessage={() => vm.messageQuery.refetch()}
            onCloseMessage={onClose}
            onAction={actions.onMailAction}
            labelName={labelName}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
