import { and, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { chatMessage, chatThread } from "@/server/db/schema";

import { getThreadForUser } from "./chat-threads";
import { sanitiseUIMessageParts, hasIncompleteParts } from "./chat-utils";

import type { PersistUserMessageInput } from "./schemas";

const TITLE_FALLBACK = "New chat";

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

export async function getMessagesForThread(userId: string, threadId: string) {
  const thread = await getThreadForUser(userId, threadId);
  if (!thread) return null;

  return db
    .select()
    .from(chatMessage)
    .where(and(eq(chatMessage.threadId, threadId), eq(chatMessage.userId, userId)))
    .orderBy(chatMessage.createdAt);
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
