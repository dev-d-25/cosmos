"use client";

import { useCallback } from "react";
import { useRefreshInbox, useClearMailCache } from "@/hooks/use-mail";

export function useMailActions({
  activeLabel,
  page,
  navigate,
}: {
  activeLabel: string;
  page: number;
  navigate: (updates: Record<string, string | null>) => void;
}) {
  const refreshMutation = useRefreshInbox();
  const clearCacheMutation = useClearMailCache();

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
          navigate({ id: null });
        }
        await refreshMutation.mutateAsync({ view: activeLabel, page });
      } catch (err) {
        console.error(`[mail action] ${action} error:`, err);
      }
    },
    [navigate, activeLabel, page, refreshMutation],
  );

  const onRefresh = useCallback(() => {
    refreshMutation.mutate({ view: activeLabel, page });
  }, [refreshMutation, activeLabel, page]);

  const onClearCache = useCallback(() => {
    clearCacheMutation.mutate();
  }, [clearCacheMutation]);

  return { refreshMutation, clearCacheMutation, onMailAction, onRefresh, onClearCache };
}