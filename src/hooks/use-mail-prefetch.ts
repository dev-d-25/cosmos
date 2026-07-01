"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useMailPrefetch({
  page,
  hasMore,
  gmailParams,
}: {
  page: number;
  hasMore: boolean;
  gmailParams: { labelIds?: string[]; query?: string };
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hasMore) return;
    const nextPage = page + 1;
    const timer = window.setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ["mail", "threads", { page: nextPage, labelIds: gmailParams.labelIds, q: gmailParams.query }],
        queryFn: () =>
          fetch(`/api/mail/threads?${new URLSearchParams({
            page: String(nextPage),
            ...(gmailParams.labelIds?.length && { labelIds: gmailParams.labelIds.join(",") }),
            ...(gmailParams.query && { q: gmailParams.query }),
          })}`, { cache: "no-store" }).then((res) => {
            if (!res.ok) throw new Error(`Failed to fetch threads (${res.status})`);
            return res.json();
          }),
        staleTime: 60 * 1000,
      });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [page, hasMore, queryClient, gmailParams.labelIds, gmailParams.query]);
}
