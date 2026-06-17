import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { kilo, DEFAULT_MODEL } from "@/lib/ai/kilo";
import { getCorsairToolsForTenant } from "@/lib/ai/corsair-tools";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getSessionTenantId } from "@/server/auth";
import { persistAssistantMessage } from "@/server/chat";
import { db } from "@/server/db";
import { chatThread } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

const bodySchema = z.object({
  threadId: z.string().min(1),
  model: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const userId = await getSessionTenantId();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: { threadId?: unknown; model?: unknown; messages?: unknown };
  try {
    raw = (await request.json()) as typeof raw;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      { status: 400 },
    );
  }

  const { threadId } = parsed.data;
  const modelId = parsed.data.model ?? DEFAULT_MODEL;

  const uiMessages = Array.isArray(raw.messages)
    ? (raw.messages as UIMessage[])
    : [];
  if (uiMessages.length === 0) {
    return new Response("messages must be a non-empty array", { status: 400 });
  }

  const [thread] = await db
    .select()
    .from(chatThread)
    .where(and(eq(chatThread.id, threadId), eq(chatThread.userId, userId)))
    .limit(1);

  if (!thread) {
    return new Response("Thread not found", { status: 404 });
  }

  if (!process.env.KILO_API_KEY) {
    return new Response(
      "KILO_API_KEY is not set. Add it to .env to enable chat.",
      { status: 503 },
    );
  }

  const { client, tools } = await getCorsairToolsForTenant(userId);

  let responseModel: string | null = modelId;
  let responseMessages: unknown[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const assistantMessageId = crypto.randomUUID();

  const modelMessages = await convertToModelMessages(uiMessages);

  const result = streamText({
    model: kilo.chat(modelId),
    system: SYSTEM_PROMPT,
    tools,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    onFinish: async ({ response, usage }) => {
      responseModel = response.modelId ?? modelId;
      const messages = await response.messages;
      responseMessages = (messages ?? []).map((m) =>
        JSON.parse(JSON.stringify(m)),
      ) as unknown[];
      inputTokens = usage.inputTokens ?? null;
      outputTokens = usage.outputTokens ?? null;
      try {
        await persistAssistantMessage(userId, threadId, {
          id: assistantMessageId,
          parts: responseMessages,
          model: responseModel,
          inputTokens,
          outputTokens,
        });
      } catch (err) {
        console.error("[chat] failed to persist assistant message", err);
      }
    },
    onError: ({ error }) => {
      console.error("[chat] stream error", error);
    },
  });

  const streamResponse = result.toUIMessageStreamResponse({
    onError: (err) => (err instanceof Error ? err.message : "Unknown error"),
    generateMessageId: () => assistantMessageId,
  });

  // Make sure the MCP client is closed after the response is sent.
  streamResponse.headers.set("x-cosmos-assistant-id", assistantMessageId);
  void client.close().catch((err) => {
    console.error("[chat] failed to close MCP client", err);
  });

  return streamResponse;
}
