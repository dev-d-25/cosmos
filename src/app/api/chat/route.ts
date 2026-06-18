import {
  convertToModelMessages,
  createIdGenerator,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { kilo, DEFAULT_MODEL } from "@/lib/ai/kilo";
import { getCorsairToolsForTenant } from "@/lib/ai/corsair-tools";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getSessionTenantId } from "@/server/auth";
import {
  getMessagesForThread,
  upsertAssistantMessage,
} from "@/server/chat";
import { db } from "@/server/db";
import { chatThread } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { convertDbMessagesToUIMessages } from "@/lib/chat/message-converter";

const bodySchema = z.object({
  threadId: z.string().min(1),
  message: z.unknown() as z.ZodType<UIMessage>,
  model: z.string().min(1).optional(),
});

type UsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
};

export async function POST(request: Request) {
  const userId = await getSessionTenantId();
  if (!userId) {
    console.log("[chat/api] Unauthorized - no userId");
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: {
    threadId?: unknown;
    message?: unknown;
    model?: unknown;
  };
  try {
    raw = (await request.json()) as typeof raw;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    console.log("[chat/api] Body validation failed:", parsed.error.issues);
    return new Response(
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      { status: 400 },
    );
  }

  const { threadId, message } = parsed.data;
  const modelId = parsed.data.model ?? DEFAULT_MODEL;

  const [thread] = await db
    .select()
    .from(chatThread)
    .where(and(eq(chatThread.id, threadId), eq(chatThread.userId, userId)))
    .limit(1);

  if (!thread) {
    console.log("[chat/api] Thread not found:", { threadId, userId });
    return new Response("Thread not found", { status: 404 });
  }

  if (!process.env.KILO_API_KEY) {
    console.log("[chat/api] KILO_API_KEY not set");
    return new Response(
      "KILO_API_KEY is not set. Add it to .env to enable chat.",
      { status: 503 },
    );
  }

  const dbMessages = await getMessagesForThread(userId, threadId);
  if (!dbMessages) {
    return new Response("Thread not found", { status: 404 });
  }

  const dbUIMessages = convertDbMessagesToUIMessages(dbMessages);

  // De-dup: the client persists the user message via /api/chat/messages BEFORE
  // calling sendMessage, so it's already in dbUIMessages. Append only if the
  // request body's message id isn't already the tail.
  const lastDbMsg = dbUIMessages[dbUIMessages.length - 1];
  const allMessages: UIMessage[] =
    lastDbMsg && lastDbMsg.id === message.id
      ? dbUIMessages
      : [...dbUIMessages, message];

  const { client, tools } = await getCorsairToolsForTenant(userId);
  console.log("[chat/api] MCP tools available:", Object.keys(tools));

  const usage: UsageSnapshot = {
    inputTokens: null,
    outputTokens: null,
    model: modelId,
  };
  let hadError = false;

  const modelMessages = await convertToModelMessages(allMessages);

  const persistAssistant = async (
    responseMessage: UIMessage,
    isAborted: boolean,
    finishReason: string | null,
    usageOverride?: { inputTokens: number | null; outputTokens: number | null },
  ) => {
    try {
      await upsertAssistantMessage(
        userId,
        threadId,
        {
          id: responseMessage.id,
          parts: responseMessage.parts ?? [],
          model: usage.model,
          inputTokens: usageOverride?.inputTokens ?? usage.inputTokens,
          outputTokens: usageOverride?.outputTokens ?? usage.outputTokens,
          incomplete: isAborted,
          finishReason,
        },
        { hadError },
      );
      console.log(
        "[chat/api] Assistant message persisted:",
        responseMessage.id,
        isAborted ? "(aborted)" : hadError ? "(error)" : "(complete)",
      );
    } catch (err) {
      console.error("[chat/api] failed to persist assistant message", err);
    }
  };

  const closeMcp = async () => {
    try {
      await client.close();
      console.log("[chat/api] MCP client closed successfully");
    } catch (err) {
      console.error("[chat/api] Failed to close MCP client:", err);
    }
  };

  const result = streamText({
    model: kilo.chat(modelId),
    system: SYSTEM_PROMPT,
    tools,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        process.stdout.write(chunk.text);
      } else if (chunk.type === "tool-call") {
        console.log("\n[chat/api] chunk:tool-call", chunk.toolName);
      } else if (chunk.type === "tool-result") {
        console.log("\n[chat/api] chunk:tool-result", chunk.toolCallId);
      } else if (chunk.type === "reasoning-delta") {
        process.stdout.write(chunk.text);
      }
    },
    onStepFinish: async ({ toolCalls, toolResults, text }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log("\n[chat/api] Tool call:", {
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            input: JSON.stringify(tc.input).slice(0, 500),
          });
        }
      }
      if (toolResults && toolResults.length > 0) {
        for (const tr of toolResults) {
          console.log("\n[chat/api] Tool result:", {
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            output: JSON.stringify(tr.output).slice(0, 500),
          });
        }
      }
      if (text) {
        console.log("\n[chat/api] Text step:", text.slice(0, 200));
      }
    },
    onFinish: async ({ response, usage: stepUsage }) => {
      // Provider finished normally. Capture usage + actual model id; persist
      // with final data. The toUIMessageStreamResponse.onFinish below may
      // also call persistAssistant — onConflictDoUpdate makes the second
      // write idempotent.
      const u: LanguageModelUsage | undefined = stepUsage;
      usage.inputTokens = u?.inputTokens ?? null;
      usage.outputTokens = u?.outputTokens ?? null;
      usage.model = response.modelId ?? modelId;
      console.log("[chat/api] Stream finished. Usage:", usage);
    },
    onError: ({ error }) => {
      console.error("[chat/api] Stream error:", error);
      hadError = true;
      client.close().catch(() => {});
    },
  });

  result.consumeStream();

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    onError: (err) => (err instanceof Error ? err.message : "Unknown error"),
    // Capture per-step usage into the assistant message's metadata so it is
    // available at onFinish time even on the cancel path (where the
    // stitchable stream's flush may not have fired yet by the time the UI
    // TransformStream cancels). The `finish` chunk itself also runs through
    // this callback and carries the final step's usage.
    messageMetadata: ({ part }) => {
      if (part.type === "finish-step") {
        const u = part.usage;
        if (u) {
          return {
            usage: {
              inputTokens: u.inputTokens ?? null,
              outputTokens: u.outputTokens ?? null,
            },
          };
        }
      }
      if (part.type === "finish") {
        const u = part.totalUsage;
        if (u) {
          return {
            usage: {
              inputTokens: u.inputTokens ?? null,
              outputTokens: u.outputTokens ?? null,
            },
          };
        }
      }
      return null;
    },
    onFinish: async ({ responseMessage, isAborted, finishReason }) => {
      const meta = responseMessage.metadata as
        | {
            usage?: { inputTokens: number | null; outputTokens: number | null };
          }
        | undefined;
      const inputTokens = meta?.usage?.inputTokens ?? usage.inputTokens;
      const outputTokens = meta?.usage?.outputTokens ?? usage.outputTokens;

      await persistAssistant(
        responseMessage,
        isAborted,
        finishReason ?? null,
        { inputTokens, outputTokens },
      );
      await closeMcp();
    },
  });
}