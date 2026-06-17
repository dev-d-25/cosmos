"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MailListResponseSchema, MailMessageSchema, MailLabelsResponseSchema } from "@/server/mail/schemas";
import type { MailListResponse, MailMessage, MailLabel, MailProfile } from "@/server/mail/schemas";

// ─── API fetchers ──────────────────────────────────────────────────────────────

async function fetchMailThreads(opts: {
  page?: number;
  pageSize?: number;
  token?: string;
  refresh?: boolean;
  labelIds?: string[];
  q?: string;
}): Promise<MailListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(opts.page ?? 0));
  params.set("pageSize", String(opts.pageSize ?? 50));
  if (opts.token) params.set("token", opts.token);
  if (opts.refresh) params.set("refresh", "true");
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
  return MailListResponseSchema.parse(json);
}

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
  threads: (opts?: { page?: number; pageSize?: number; token?: string; labelIds?: string[]; q?: string }) =>
    [...mailKeys.all, "threads", opts] as const,
  message: (id: string) => [...mailKeys.all, "message", id] as const,
  labels: () => [...mailKeys.all, "labels"] as const,
  profile: () => [...mailKeys.all, "profile"] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────────────

export function useMailThreads(opts: {
  page?: number;
  pageSize?: number;
  token?: string;
  refresh?: boolean;
  labelIds?: string[];
  q?: string;
  initialData?: MailListResponse;
}) {
  return useQuery({
    queryKey: mailKeys.threads({ page: opts.page, pageSize: opts.pageSize, token: opts.token, labelIds: opts.labelIds, q: opts.q }),
    queryFn: () => fetchMailThreads(opts),
    initialData: opts.initialData,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
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
      queryClient.invalidateQueries({ queryKey: mailKeys.all });
    },
  });
}

export function useClearMailCache() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearMailCache,
    onSuccess: () => {
      queryClient.setQueryData(mailKeys.threads({ page: 0, pageSize: 50, token: undefined, q: undefined }), {
        items: [],
        nextPageToken: null,
        source: "cache" as const,
        totalCount: 0,
      });
      queryClient.invalidateQueries({ queryKey: mailKeys.all });
    },
  });
}
