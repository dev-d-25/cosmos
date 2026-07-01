"use client";

import { useMemo } from "react";
import { useMailThreads, useMailMessage, useMailLabels, useMailProfile } from "@/hooks/use-mail";
import type { MailListResponse, MailListItem, MailLabel, MailProfile } from "@/server/mail/schemas";
import type { MailSyncedState } from "@/types/mail";

interface UseMailViewModelOpts {
  initial: MailListResponse;
  initialLabel: string;
  page: number;
  selectedId: string | null;
  searchQuery: string;
  gmailParams: { labelIds?: string[]; query?: string };
  activeLabel: string;
  gmailConnected: boolean;
}

export function useMailViewModel({
  initial,
  initialLabel,
  page,
  selectedId,
  searchQuery,
  gmailParams,
  activeLabel,
  gmailConnected,
}: UseMailViewModelOpts) {
  const threadsQuery = useMailThreads({
    page,
    labelIds: gmailParams.labelIds,
    q: gmailParams.query,
    initialData: gmailConnected ? initial : undefined,
  });

  const labelsQuery = useMailLabels(gmailConnected ? [] : undefined);
  const profileQuery = useMailProfile(gmailConnected ? null : undefined);
  const messageQuery = useMailMessage(selectedId);

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

  const syncedState: MailSyncedState = !gmailConnected
    ? "Not connected"
    : threadsQuery.isLoading
      ? "Loading..."
      : items.length === 0 && count === 0
        ? "No mail cached"
        : "Synced";

  const selectedListItem = items.find((i) => i.id === selectedId) ?? null;

  return {
    items,
    count,
    totalPages,
    hasMore,
    hasPrev,
    pageFromResponse,
    cacheState,
    coverage,
    degraded,
    source,
    labels,
    profile,
    selectedListItem,
    syncedState,
    threadsQuery,
    labelsQuery,
    profileQuery,
    messageQuery,
  };
}