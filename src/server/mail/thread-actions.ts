"use server";

import { corsair } from "@/server/corsair";
import { getClient } from "./mail-list";
import { invalidateMailListCacheForTenant } from "./mail-page-cache";

type Mutation = (input: {
  client: ReturnType<typeof corsair.withTenant>;
  threadId?: string;
  ids?: string[];
  labelId?: string;
}) => Promise<void>;

export type ThreadActionName =
  | "archive" | "trash" | "star" | "unstar"
  | "markRead" | "markUnread"
  | "spam" | "delete";

const MUTATIONS: Record<ThreadActionName, Mutation> = {
  archive:   async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.modify({ id, removeLabelIds: ["INBOX"] });
  },
  trash:     async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.trash({ id });
  },
  star:      async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.modify({ id, addLabelIds: ["STARRED"] });
  },
  unstar:    async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.modify({ id, removeLabelIds: ["STARRED"] });
  },
  spam:      async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.modify({ id, addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] });
  },
  delete:    async ({ client, threadId, ids }) => {
    const targetIds = ids?.length ? ids : threadId ? [threadId] : [];
    for (const id of targetIds) await client.gmail.api.threads.delete({ id });
  },
  markRead:  async ({ client, ids }) => { await client.gmail.api.messages.batchModify({ ids: ids!, removeLabelIds: ["UNREAD"] }); },
  markUnread:async ({ client, ids }) => { await client.gmail.api.messages.batchModify({ ids: ids!, addLabelIds: ["UNREAD"] }); },
};

export async function applyThreadAction(
  action: ThreadActionName,
  input: { threadId?: string; ids?: string[]; labelId?: string },
): Promise<{ marked?: number } | void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await invalidateMailListCacheForTenant(ctx.tenantId);
  const fn = MUTATIONS[action];
  if (!fn) throw new Error(`Unknown thread action: ${action}`);
  await fn({ client: ctx.client, ...input });
  if (action === "markRead") return { marked: input.ids?.length ?? 0 };
}

export async function markAsRead(
  ids: string[],
): Promise<{ marked: number }> {
  return applyThreadAction("markRead", { ids }) as Promise<{ marked: number }>;
}
