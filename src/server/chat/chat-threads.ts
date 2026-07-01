import { randomUUID } from "crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import { chatThread } from "@/server/db/schema";

import type { CreateThreadInput, UpdateThreadInput } from "./schemas";

const TITLE_FALLBACK = "New chat";

function newId(): string {
  return randomUUID();
}

export async function listThreadsForUser(userId: string) {
  return db
    .select()
    .from(chatThread)
    .where(and(eq(chatThread.userId, userId), isNull(chatThread.archivedAt)))
    .orderBy(desc(chatThread.updatedAt));
}

export async function getThreadForUser(userId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(chatThread)
    .where(and(eq(chatThread.id, threadId), eq(chatThread.userId, userId)))
    .limit(1);
  return thread ?? null;
}

export async function createThread(userId: string, input: CreateThreadInput) {
  const id = newId();
  const title = input.title?.trim() || TITLE_FALLBACK;
  const [thread] = await db
    .insert(chatThread)
    .values({
      id,
      userId,
      title,
      model: input.model,
    })
    .returning();
  return thread;
}

export async function updateThread(
  userId: string,
  threadId: string,
  input: UpdateThreadInput,
) {
  const thread = await getThreadForUser(userId, threadId);
  if (!thread) return null;

  const patch: Partial<typeof chatThread.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) patch.title = input.title.trim() || thread.title;
  if (input.model !== undefined) patch.model = input.model;
  if (input.archived !== undefined) {
    patch.archivedAt = input.archived ? new Date() : null;
  }

  const [updated] = await db
    .update(chatThread)
    .set(patch)
    .where(and(eq(chatThread.id, threadId), eq(chatThread.userId, userId)))
    .returning();

  return updated ?? null;
}

export async function deleteThread(userId: string, threadId: string) {
  const result = await db
    .delete(chatThread)
    .where(and(eq(chatThread.id, threadId), eq(chatThread.userId, userId)))
    .returning({ id: chatThread.id });
  return result.length > 0;
}
