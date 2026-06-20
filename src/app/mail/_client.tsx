"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

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
import { PAGE_SIZE } from "@/server/mail/schemas";
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

/**
 * Parse a `?page` query value into a positive integer. Returns 1 for
 * null/undefined/non-finite/non-positive input. Single source of truth
 * for the page parser — same function on SSR and client.
 */
function parsePageParam(raw: string | null | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Parse a `?label` query value into a label id. Defaults to INBOX.
 */
function parseLabelParam(
  raw: string | null | undefined,
  fallback: string,
): string {
  return raw && raw.length > 0 ? raw : fallback;
}

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ─── URL is the single source of truth ─────────────────────────────────
  // We never mirror these into useState. Every URL change triggers a
  // re-render via useSearchParams, TanStack Query refetches with the new
  // params, and the pager math falls out of the response. No juggling.

  const activeLabel = parseLabelParam(searchParams.get("label"), initialLabel);
  const labelDef = MAIL_LABELS.find((l) => l.id === activeLabel);
  const labelName = labelDef?.name ?? activeLabel;

  const selectedId = searchParams.get("id") ?? initialSelectedId ?? null;
  const searchQuery = searchParams.get("q") ?? "";
  const page = parsePageParam(searchParams.get("page"));

  const gmailParams = useMemo(
    () =>
      searchQuery
        ? { query: searchQuery }
        : getGmailParamsForView(activeLabel),
    [activeLabel, searchQuery],
  );

  const [composeOpen, setComposeOpen] = useStateShim(false);
  const [shortcutsOpen, setShortcutsOpen] = useStateShim(false);

  const threadsQuery = useMailThreads({
    page,
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

  // Auto-refresh when redirected after OAuth connect (?connected=gmail)
  const connectedPlugin = searchParams.get("connected");
  useEffect(() => {
    if (connectedPlugin) {
      refreshMutation.mutate();
      navigate({ connected: null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const messageQuery = useMailMessage(selectedId);

  // ─── URL writers (the only writer) ──────────────────────────────────────
  //
  // Every URL mutation goes through buildUrl(). router.replace is the only
  // function that touches the URL. This eliminates the prior
  // useState+history.replaceState race that produced stale state after
  // back/forward navigation.

  const buildUrl = useCallback(
    (updates: Record<string, string | null>): string => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = useCallback(
    (updates: Record<string, string | null>) => {
      router.replace(buildUrl(updates), { scroll: false });
    },
    [router, buildUrl],
  );

  // ─── Ctrl+K to open search ──────────────────────────────────────────────
  const handleShortcut = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    },
    [router],
  );
  useGlobalKeydown(handleShortcut);

  // ─── Derived state (read straight off the response) ─────────────────────
  const responseItems = threadsQuery.data?.items ?? [];
  const items: MailListItem[] = useMemo(() => {
    const seen = new Set<string>();
    return responseItems.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [responseItems]);

  const count = threadsQuery.data?.count ?? null;
  const totalPages = threadsQuery.data?.totalPages ?? null;
  const hasMore = threadsQuery.data?.hasMore ?? false;
  const hasPrev = threadsQuery.data?.hasPrev ?? false;
  const pageFromResponse = threadsQuery.data?.page ?? page;
  const cacheState = threadsQuery.data?.cacheState ?? "empty";
  const coverage = threadsQuery.data?.coverage ?? 0;
  const degraded = threadsQuery.data?.degraded ?? false;
  const source = threadsQuery.data?.source ?? "cache";

  const labels: MailLabel[] = labelsQuery.data ?? [];
  const profile: MailProfile | null = profileQuery.data ?? null;

  const syncedState: SyncedState = !gmailConnected
    ? "Not connected"
    : threadsQuery.isLoading
      ? "Loading..."
      : items.length === 0 && count === 0
        ? "No mail cached"
        : "Synced";

  const selectedListItem = items.find((i) => i.id === selectedId) ?? null;

  // ─── Pager math falls out of the response ──────────────────────────────
  // No client-side totalPages derivation. The server's response IS the
  // math. When the URL changes, the query refetches, the new response
  // lands, and the pager renders from it.

  const onSelect = useCallback(
    (id: string) => {
      markAsReadLocally(id);
      navigate({ id });
    },
    [navigate],
  );

  const onOpen = useCallback(
    (id: string) => {
      navigate({ id });
    },
    [navigate],
  );

  const onPageChange = useCallback(
    (newPage: number) => {
      // 1-based. The server clamps.
      navigate({ page: newPage > 1 ? String(newPage) : null });
    },
    [navigate],
  );

  const onClose = useCallback(() => {
    navigate({ id: null });
  }, [navigate]);

  const onRefresh = useCallback(() => {
    refreshMutation.mutate();
  }, [refreshMutation]);

  const onClearCache = useCallback(() => {
    clearCacheMutation.mutate();
  }, [clearCacheMutation]);

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
          // Optimistic: close viewer. URL drops ?id.
          navigate({ id: null });
        }
        // Refetch threads so the action's effect on labels/count is
        // reflected immediately.
        await threadsQuery.refetch();
      } catch (err) {
        console.error(`[mail action] ${action} error:`, err);
      }
    },
    [navigate, threadsQuery],
  );

  const setSearchQuery = useCallback(
    (q: string) => {
      // Search is mutually exclusive with label; q wins.
      navigate(q ? { q, page: null, label: null } : { q: null, page: null });
    },
    [navigate],
  );

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  useMailShortcuts({
    items,
    selectedId,
    setSelectedId: (valueOrUpdater) => {
      const nextId = typeof valueOrUpdater === "function"
        ? valueOrUpdater(selectedId)
        : valueOrUpdater;
      navigate({ id: nextId });
    },
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
          <MailSidebar
            labels={labels}
            activeLabel={activeLabel}
            profile={profile}
            onCompose={() => setComposeOpen(true)}
          />
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
              page={pageFromResponse}
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
              loading={threadsQuery.isFetching}
              error={null}
              isInitialLoading={threadsQuery.isLoading}
              labelName={labelName}
              searchQuery={searchQuery || undefined}
              onClearSearch={() => setSearchQuery("")}
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

// ──────────────────────────────────────────────────────────────────────────────
// Local helpers: tiny wrappers around useState so this file is self-contained.
// Inlined here rather than imported from a hook to keep the diff focused on
// the URL-as-truth refactor.

import { useEffect, useState } from "react";

function useStateShim<T>(initial: T): [T, (v: T) => void] {
  return useState<T>(initial);
}

function useGlobalKeydown(handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
