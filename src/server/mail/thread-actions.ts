"use server";

import { corsair } from "@/server/corsair";
import { getSessionTenantId, getAccountIdForTenant } from "@/server/connected-account";

// ─── Cache invalidation (imported from mail-list at call time) ────────
let _invalidateMailListCacheForTenant: ((tenantId: string) => void) | null = null;

async function getInvalidate() {
  if (!_invalidateMailListCacheForTenant) {
    const mod = await import("./mail-list");
    _invalidateMailListCacheForTenant = mod.invalidateMailListCacheForTenant;
  }
  return _invalidateMailListCacheForTenant;
}

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

export async function markAsRead(
  ids: string[],
): Promise<{ marked: number }> {
  const ctx = await getClient();
  if (!ctx || ids.length === 0) return { marked: 0 };
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.messages.batchModify({
    ids,
    removeLabelIds: ["UNREAD"],
  });
  return { marked: ids.length };
}

export async function archiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["INBOX"],
  });
}

export async function unarchiveThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["INBOX"],
  });
}

export async function trashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.trash({ id: threadId });
}

export async function untrashThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.untrash({ id: threadId });
}

export async function starThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["STARRED"],
  });
}

export async function unstarThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: ["STARRED"],
  });
}

export async function markAsUnread(ids: string[]): Promise<void> {
  const ctx = await getClient();
  if (!ctx || ids.length === 0) return;
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.messages.batchModify({
    ids,
    addLabelIds: ["UNREAD"],
  });
}

export async function moveToSpam(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: ["SPAM"],
    removeLabelIds: ["INBOX"],
  });
}

export async function moveThreadToLabel(
  threadId: string,
  labelId: string,
): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    addLabelIds: [labelId],
  });
}

export async function removeLabelFromThread(
  threadId: string,
  labelId: string,
): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.modify({
    id: threadId,
    removeLabelIds: [labelId],
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const invalidate = await getInvalidate();
  invalidate(ctx.tenantId);
  await ctx.client.gmail.api.threads.delete({ id: threadId });
}
