"use client";

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { MailTag } from "./mail-tag";
import { MailToolbarButton } from "./mail-toolbar-button";
import { StarIcon } from "lucide-react";
import type { MailListItem } from "@/server/mail/schemas";
import { formatReceived } from "@/lib/mail/format";
import { isReadLocally } from "@/lib/read-emails";

export function MailList({
  items,
  selectedId,
  onSelect,
  onOpen,
  page,
  totalPages,
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
  totalPages: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  error: string | null;
  isInitialLoading: boolean;
  labelName: string;
  searchQuery?: string;
  onClearSearch?: () => void;
}) {
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
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">
            <p>{searchQuery ? "No results found." : "No mail in this folder."}</p>
          </div>
        </div>
      </div>
    );
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-message-id="${selectedId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

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
            <button
              key={item.id}
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
        })}
      </div>

      {totalPages > 1 ? (
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 0 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
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
                  {pageNum + 1}
                </Button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
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
