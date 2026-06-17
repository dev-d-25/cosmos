"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
import type {
  MailLabel,
  MailListItem,
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
import { markAsReadLocally } from "@/lib/read-emails";
import type { MailSyncedState as SyncedState } from "@/types/mail";
import { getGmailParamsForView, MAIL_LABELS } from "@/lib/mail/labels";


// ─── Main Interface ─────────────────────────────────────────────────────────

export function MailInterface({
  initial,
  initialLabel,
  initialPage,
  initialSelectedId,
}: {
  initial: MailPageData;
  initialLabel: string;
  initialPage?: number;
  initialSelectedId?: string | null;
}) {
  const gmailConnected = initial.gmailConnected;
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeLabel = searchParams.get("label") ?? initialLabel ?? "INBOX";
  const labelDef = MAIL_LABELS.find((l) => l.id === activeLabel);
  const labelName = labelDef?.name ?? activeLabel;

  // ─── Local UI state ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("id") ?? initialSelectedId ?? null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const gmailParams = searchQuery
    ? { query: searchQuery }
    : getGmailParamsForView(activeLabel);

  // ─── TanStack Query hooks ──────────────────────────────────────────────
  const [pageIndex, setPageIndex] = useState(() => {
    const urlPage = searchParams.get("page");
    return urlPage ? Math.max(0, Number(urlPage)) : (initialPage ?? 0);
  });
  const [pageTokens, setPageTokens] = useState<(string | undefined)[]>(() => {
    const urlPage = searchParams.get("page");
    const idx = urlPage ? Math.max(0, Number(urlPage)) : (initialPage ?? 0);
    return Array.from({ length: idx + 1 }, (_, i) => undefined);
  });
  const [pageError, setPageError] = useState<string | null>(null);

  const currentPageToken = pageTokens[pageIndex];

  // Reset pagination when search query or label changes
  useEffect(() => {
    setPageIndex(0);
    setPageTokens([undefined]);
  }, [searchQuery, activeLabel]);

  const threadsQuery = useMailThreads({
    page: pageIndex,
    pageSize: 50,
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
  const totalCount = threadsQuery.data?.totalCount ?? 0;
  const pageSize = 50;
  const totalPages = totalCount > 0
    ? Math.ceil(totalCount / pageSize)
    : Math.max(1, pageIndex + 1 + (hasMore ? 1 : 0));

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

  // ─── Sync pageIndex and selectedId to URL ──────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (pageIndex > 0) {
      params.set("page", String(pageIndex));
    } else {
      params.delete("page");
    }
    if (selectedId) {
      params.set("id", selectedId);
    } else {
      params.delete("id");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [pageIndex, selectedId, router]);

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
    navigate: (url: string) => router.push(url),
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
