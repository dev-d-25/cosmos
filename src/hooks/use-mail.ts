"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MailMessageSchema, MailLabelsResponseSchema, PAGE_SIZE } from "@/server/mail/schemas";
import type { MailListResponse, MailMessage, MailLabel, MailProfile } from "@/server/mail/schemas";

// ─── API fetchers ──────────────────────────────────────────────────────────────

async function fetchMailThreads(opts: {
  page?: number;
  labelIds?: string[];
  q?: string;
}): Promise<MailListResponse> {
  const params = new URLSearchParams();
  // page is 1-based; backend clamps and echoes.
  params.set("page", String(opts.page ?? 1));
  if (opts.labelIds?.length) params.set("labelIds", opts.labelIds.join(","));
  if (opts.q) params.set("q", opts.q);

  const res = await fetch(`/api/mail/threads?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch threads (${res.status})`);
  }
  const json = await res.json();
  // The route returns the validated v2 shape (items, count, page,
  // totalPages, hasMore, hasPrev, cacheState, coverage, source, degraded).
  // We do not parse through MailListResponseSchema here because we want
  // the client to read whatever the server sent verbatim.
  return json as MailListResponse;
}

export { fetchMailThreads };

async function fetchMailMessage(
  id: string,
  opts?: { refresh?: boolean },
): Promise<{ message: MailMessage; source: "cache" | "live" }> {
  const params = new URLSearchParams();
  if (opts?.refresh) params.set("refresh", "true");

  const qs = params.toString();
  const res = await fetch(`/api/mail/messages/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch message (${res.status})`);
  }
  const json = await res.json();
  const parsed = MailMessageSchema.safeParse(json.message);
  if (!parsed.success) {
    throw new Error("Invalid message payload from server");
  }
  return { message: parsed.data, source: json.source ?? "live" };
}

async function fetchMailLabels(): Promise<MailLabel[]> {
  const res = await fetch("/api/mail/labels", { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch labels (${res.status})`);
  }
  const json = await res.json();
  return MailLabelsResponseSchema.parse(json);
}

async function fetchMailProfile(): Promise<MailProfile | null> {
  const res = await fetch("/api/mail/profile", { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 409) return null;
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch profile (${res.status})`);
  }
  return res.json();
}

async function refreshInbox(): Promise<{ synced: number }> {
  const res = await fetch("/api/mail/refresh", {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to refresh inbox (${res.status})`);
  }
  return res.json();
}

async function clearMailCache(): Promise<{ deletedMessages: number; deletedLabels: number }> {
  const res = await fetch("/api/mail/clear", {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to clear mail cache (${res.status})`);
  }
  return res.json();
}

// ─── Query keys ────────────────────────────────────────────────────────────────

export const mailKeys = {
  all: ["mail"] as const,
  threads: (opts?: { page?: number; labelIds?: string[]; q?: string }) =>
    [...mailKeys.all, "threads", opts] as const,
  message: (id: string) => [...mailKeys.all, "message", id] as const,
  labels: () => [...mailKeys.all, "labels"] as const,
  profile: () => [...mailKeys.all, "profile"] as const,
};

async function fetchPrefetchMessage(id: string): Promise<{ id: string; ok: boolean; error?: string }> {
  const res = await fetch(`/api/mail/messages/${encodeURIComponent(id)}/prefetch`, {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Prefetch failed (${res.status})`);
  }
  return res.json();
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────

export function useMailThreads(opts: {
  page?: number;
  labelIds?: string[];
  q?: string;
  initialData?: MailListResponse;
}) {
  return useQuery({
    queryKey: mailKeys.threads({ page: opts.page, labelIds: opts.labelIds, q: opts.q }),
    queryFn: () => fetchMailThreads(opts),
    initialData: opts.initialData,
    placeholderData: (prev) => prev,
    // No staleTime — every navigation refetches so deep-jumps don't serve
    // a stale empty payload. The client-side page N+1 prefetch warms the
    // next cache slot before the user clicks, so the refetch resolves
    // from the TanStack cache, not the network.
  });
}

export function useMailMessage(id: string | null) {
  return useQuery({
    queryKey: mailKeys.message(id ?? ""),
    queryFn: () => fetchMailMessage(id!),
    enabled: !!id,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMailLabels(initialData?: MailLabel[]) {
  return useQuery({
    queryKey: mailKeys.labels(),
    queryFn: fetchMailLabels,
    initialData,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMailProfile(initialData?: MailProfile | null) {
  return useQuery({
    queryKey: mailKeys.profile(),
    queryFn: fetchMailProfile,
    initialData,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRefreshInbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshInbox,
    onSuccess: () => {
      // Refetch every active mail query. TanStack will re-read params from
      // each subscriber's useMailThreads call, so the current page reloads.
      queryClient.invalidateQueries({ queryKey: mailKeys.all, refetchType: "all" });
    },
  });
}

/**
 * Fire-and-forget prefetch of a message's full body. Writes to the local
 * DB so the next useMailMessage(id) call hits cache instead of Gmail.
 *
 * Caller is responsible for deduplicating per id (use a Set in the parent
 * component — TanStack useMutation does not dedupe by arg).
 */
export function usePrefetchFullBody() {
  return useMutation({
    mutationFn: fetchPrefetchMessage,
  });
}

export function useClearMailCache() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearMailCache,
    onSuccess: () => {
      // Invalidate every mail query — no optimistic setQueryData so we
      // avoid the setQueryData-then-invalidate anti-pattern (PAT-03).
      queryClient.invalidateQueries({ queryKey: mailKeys.all, refetchType: "all" });
    },
  });
}

// Re-export PAGE_SIZE so client code that wants to render "Showing N" text
// can use the same constant the server used.
export { PAGE_SIZE };
