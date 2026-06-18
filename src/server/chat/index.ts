import { randomUUID } from "crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { chatMessage, chatThread } from "@/server/db/schema";

import type {
  CreateThreadInput,
  PersistUserMessageInput,
  UpdateThreadInput,
} from "./schemas";

const TITLE_FALLBACK = "New chat";

function newId(): string {
  return randomUUID();
}

function deriveTitle(parts: unknown[]): string {
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      (part as { type: unknown }).type === "text" &&
      "text" in part &&
      typeof (part as { text: unknown }).text === "string"
    ) {
      const text = ((part as { text: string }).text || "").trim();
      if (text) return text.slice(0, 60);
    }
  }
  return TITLE_FALLBACK;
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

export async function getMessagesForThread(userId: string, threadId: string) {
  const thread = await getThreadForUser(userId, threadId);
  if (!thread) return null;

  return db
    .select()
    .from(chatMessage)
    .where(and(eq(chatMessage.threadId, threadId), eq(chatMessage.userId, userId)))
    .orderBy(chatMessage.createdAt);
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

export async function persistUserMessage(
  userId: string,
  input: PersistUserMessageInput,
) {
  const thread = await getThreadForUser(userId, input.threadId);
  if (!thread) return null;

  const [message] = await db
    .insert(chatMessage)
    .values({
      id: input.id,
      threadId: input.threadId,
      userId,
      role: "user",
      parts: input.parts,
      model: thread.model,
    })
    .returning();

  await db
    .update(chatThread)
    .set({ updatedAt: new Date() })
    .where(eq(chatThread.id, input.threadId));

  if (thread.title === TITLE_FALLBACK) {
    const title = deriveTitle(input.parts);
    if (title !== TITLE_FALLBACK) {
      await db
        .update(chatThread)
        .set({ title, updatedAt: new Date() })
        .where(eq(chatThread.id, input.threadId));
    }
  }

  return message ?? null;
}

export type AssistantPersistInput = {
  id: string;
  parts: unknown[];
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  incomplete?: boolean;
  finishReason?: string | null;
};

export function sanitiseUIMessageParts(
  parts: unknown[],
  isAborted: boolean,
): unknown[] {
  if (!Array.isArray(parts)) return [];
  if (!isAborted) return parts;

  return parts.map((raw) => {
    const p = raw as {
      type?: string;
      state?: string;
      text?: string;
      toolCallId?: string;
      errorText?: string;
    };
    if (!p || typeof p !== "object" || typeof p.type !== "string") return raw;

    if (
      (p.type === "text" || p.type === "reasoning") &&
      p.state !== "done"
    ) {
      return { ...p, state: "done" };
    }

    if (p.type.startsWith("tool-") && p.state === "input-streaming") {
      return {
        ...p,
        state: "output-error",
        errorText: p.errorText ?? "Stream interrupted",
      };
    }

    return raw;
  });
}

function hasIncompleteParts(parts: unknown[]): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((raw) => {
    const p = raw as { type?: string; state?: string };
    if (!p || typeof p !== "object" || typeof p.type !== "string") return false;
    if (p.type === "text" || p.type === "reasoning")
      return p.state !== "done";
    if (p.type.startsWith("tool-"))
      return p.state === "input-streaming" || p.state === "input-available";
    return false;
  });
}

export async function upsertAssistantMessage(
  userId: string,
  threadId: string,
  message: AssistantPersistInput,
  options: { hadError?: boolean } = {},
) {
  const thread = await getThreadForUser(userId, threadId);
  if (!thread) return null;

  const isAborted = message.incomplete === true;
  const parts = sanitiseUIMessageParts(message.parts, isAborted);
  const incomplete = isAborted || hasIncompleteParts(parts) || options.hadError;

  const [row] = await db
    .insert(chatMessage)
    .values({
      id: message.id,
      threadId,
      userId,
      role: "assistant",
      parts,
      model: message.model ?? null,
      inputTokens: message.inputTokens ?? null,
      outputTokens: message.outputTokens ?? null,
      incomplete,
      finishReason: message.finishReason ?? null,
    })
    .onConflictDoUpdate({
      target: chatMessage.id,
      set: {
        parts: sql`EXCLUDED.parts`,
        model: sql`EXCLUDED.model`,
        inputTokens: sql`EXCLUDED.input_tokens`,
        outputTokens: sql`EXCLUDED.output_tokens`,
        incomplete: sql`EXCLUDED.incomplete`,
        finishReason: sql`EXCLUDED.finish_reason`,
      },
    })
    .returning();

  await db
    .update(chatThread)
    .set({ updatedAt: new Date() })
    .where(eq(chatThread.id, threadId));

  return row ?? null;
}
