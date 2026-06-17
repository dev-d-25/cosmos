"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatThread } from "@/types/chat";

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchThreads(): Promise<ChatThread[]> {
  const res = await fetch("/api/chat/threads");
  if (!res.ok) throw new Error("Failed to load threads");
  const data = await res.json();
  return data.threads;
}

async function createThread(body: {
  model: string;
  title?: string;
}): Promise<ChatThread> {
  const res = await fetch("/api/chat/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create thread");
  const data = await res.json();
  return data.thread;
}

async function fetchThread(
  id: string,
): Promise<{ thread: ChatThread; messages: unknown[] }> {
  const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch thread");
  return res.json();
}

async function updateThread(
  id: string,
  body: { title?: string; model?: string; archived?: boolean },
): Promise<ChatThread> {
  const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update thread");
  const data = await res.json();
  return data.thread;
}

async function deleteThread(id: string): Promise<void> {
  const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete thread");
}

async function persistUserMessage(body: {
  threadId: string;
  id: string;
  parts: unknown[];
}): Promise<unknown> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to persist message");
  const data = await res.json();
  return data.message;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const chatKeys = {
  all: ["chat"] as const,
  threads: () => [...chatKeys.all, "threads"] as const,
  thread: (id: string) => [...chatKeys.all, "thread", id] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useChatThreads() {
  return useQuery({
    queryKey: chatKeys.threads(),
    queryFn: fetchThreads,
    staleTime: 60_000,
  });
}

export function useChatThread(id: string | null) {
  return useQuery({
    queryKey: chatKeys.thread(id ?? ""),
    queryFn: () => fetchThread(id!),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createThread,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.threads() });
    },
  });
}

export function useUpdateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string; title?: string; model?: string; archived?: boolean }) =>
      updateThread(id, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.threads() });
      qc.invalidateQueries({ queryKey: chatKeys.thread(variables.id) });
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteThread,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.threads() });
    },
  });
}

export function usePersistUserMessage() {
  return useMutation({
    mutationFn: persistUserMessage,
  });
}
