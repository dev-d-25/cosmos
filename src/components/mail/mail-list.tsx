"use client";

import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { MailTag } from "./mail-tag";
import { MailToolbarButton } from "./mail-toolbar-button";
import { StarIcon } from "lucide-react";
import type { MailListItem } from "@/server/mail/schemas";
import { formatReceived } from "@/lib/mail/format";
import { isReadLocally } from "@/lib/read-emails";
import { usePrefetchFullBody } from "@/hooks/use-mail";

const PREFETCH_DWELL_MS = 200;
const PREFETCH_VISIBLE_RATIO = 0.5;

/**
 * One row in the mail list. Owns its own IntersectionObserver: when ≥50%
 * of the row is visible for 200ms, fires onPrefetch once. The parent
 * passes a Set-tracked callback so duplicates across rows are deduped.
 */
function MailListRow({
  item,
  isSelected,
  isRead,
  onSelect,
  onOpen,
  onPrefetch,
}: {
  item: MailListItem;
  isSelected: boolean;
  isRead: boolean;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  onPrefetch: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);
  const onPrefetchRef = useRef(onPrefetch);
  onPrefetchRef.current = onPrefetch;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    firedRef.current = false;

    let dwellTimer: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= PREFETCH_VISIBLE_RATIO) {
          if (dwellTimer === null && !firedRef.current) {
            dwellTimer = window.setTimeout(() => {
              firedRef.current = true;
              onPrefetchRef.current(item.id);
              dwellTimer = null;
            }, PREFETCH_DWELL_MS);
          }
        } else if (dwellTimer !== null) {
          clearTimeout(dwellTimer);
          dwellTimer = null;
        }
      },
      { threshold: PREFETCH_VISIBLE_RATIO },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (dwellTimer !== null) clearTimeout(dwellTimer);
    };
  }, [item.id]);

  return (
    <button
      ref={ref}
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
                  "CATEGORY_SOCIAL",
                  "CATEGORY_UPDATES",
                  "CATEGORY_PROMOTIONS",
                  "CATEGORY_FORUMS",
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
}

export type CacheState = "full" | "partial" | "empty";

export function MailList({
  items,
  selectedId,
  onSelect,
  onOpen,
  page,
  totalPages,
  hasMore,
  hasPrev,
  pageSize,
  count,
  cacheState,
  coverage,
  degraded,
  source,
  onPageChange,
  loading,
  error,
  isInitialLoading,
  labelName,
  searchQuery,
  onClearSearch,
}: {
  items: MailListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  hasPrev: boolean;
  pageSize: number;
  count: number | null;
  cacheState: CacheState;
  coverage: number;
  degraded: boolean;
  source: "cache" | "live" | "syncing";
  onPageChange: (page: number) => void;
  loading: boolean;
  error: string | null;
  isInitialLoading: boolean;
  labelName: string;
  searchQuery?: string;
  onClearSearch?: () => void;
}) {
  const prefetchMutation = usePrefetchFullBody();
  // In-flight ids: don't fire the same id twice concurrently.
  const inflightRef = useRef<Set<string>>(new Set());
  // Failed ids for this page-load: don't retry until the user navigates
  // or the cache is cleared. Without this, a 401 from an expired token
  // (or a transient Gmail error) hammers the server on every
  // IntersectionObserver cycle for visible rows.
  const failedRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const onPrefetch = useCallback(
    (id: string) => {
      // Skip ids that already failed this cycle. The retry would hit the
      // same 401 / rate-limit error and waste a server round-trip.
      if (failedRef.current.has(id)) return;
      if (inflightRef.current.has(id)) return;
      inflightRef.current.add(id);
      prefetchMutation.mutate(id, {
        onError: () => {
          // Mark failed so we don't keep retrying. The user can clear
          // the cache to reset, or the next page navigation will get a
          // fresh row set with empty failedRef.
          failedRef.current.add(id);
        },
        onSettled: () => {
          inflightRef.current.delete(id);
        },
      });
    },
    [prefetchMutation],
  );

  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-message-id="${selectedId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

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
    const showSyncPill = count !== null && count > 0 && cacheState !== "full";
    const showLoading = loading && count !== null && count > 0;
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
                  <path d="M18 6L6 18M6 6l12 18" />
                </svg>
              </button>
            </div>
          ) : (
            <span className="text-sm font-semibold">{labelName}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {showLoading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
              <div className="flex flex-col items-center gap-2">
                <div className="border-muted-foreground/30 border-t-muted-foreground size-5 animate-spin rounded-full border-2" />
                <p>Loading page {page}…</p>
              </div>
            </div>
          ) : showSyncPill ? (
            <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
              <div className="flex flex-col items-center gap-1.5">
                <p>
                  {cacheState === "empty"
                    ? `No cache yet for this page · ${count} total`
                    : `Syncing ${Math.floor(coverage * count)}/${count}…`}
                  {degraded ? " · count may be stale" : null}
                </p>
                <p className="text-muted-foreground/70">click Refresh in the toolbar to sync</p>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
              <p>{searchQuery ? "No results found." : "No mail in this folder."}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

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
            <MailListRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              isRead={isRead}
              onSelect={onSelect}
              onOpen={onOpen}
              onPrefetch={onPrefetch}
            />
          );
        })}
      </div>

      {/*
        Pager only renders when we know the total. For free-text search
        (totalPages === null), the pager is hidden and the list header
        shows the "Showing the first N" text instead.

        Page numbers come from the server's response — the client never
        derives them. hasMore/hasPrev are the source of truth for the
        Prev/Next enabled state.
      */}
      {totalPages !== null && totalPages > 1 ? (
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrev || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page < 3) {
                pageNum = i + 1;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i + 1;
              } else {
                pageNum = page - 3 + i + 1;
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
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {/*
        Syncing / degraded pill — appears between the list and the pager
        when the cache is still filling or when the count fell back to a
        less-accurate source. Search results (count === null) skip this.
      */}
      {count !== null && (cacheState !== "full" || degraded) ? (
        <div className="border-border text-muted-foreground border-t px-4 py-1.5 text-[0.625rem]">
          {cacheState === "empty"
            ? "No cache yet — click Refresh to sync."
            : cacheState === "partial"
              ? `Syncing ${Math.floor(coverage * count)}/${count}…`
              : null}
          {degraded ? " · count may be stale" : null}
        </div>
      ) : null}

      {/* Search header: pager is hidden, show the "first N" line. */}
      {searchQuery && count === null && items.length > 0 ? (
        <div className="border-border text-muted-foreground border-t px-4 py-1.5 text-[0.625rem]">
          Showing the first {items.length} of many — refine your search to narrow results.
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
