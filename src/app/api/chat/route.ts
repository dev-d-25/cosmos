import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
  type ToolCallPart,
  type TextPart,
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
    console.log("[chat/api] Unauthorized - no userId");
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: { threadId?: unknown; model?: unknown; messages?: unknown };
  try {
    raw = (await request.json()) as typeof raw;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  console.log("[chat/api] Received:", {
    threadId: raw.threadId,
    model: raw.model,
    messagesCount: Array.isArray(raw.messages) ? raw.messages.length : 0,
    userId,
  });

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    console.log("[chat/api] Body validation failed:", parsed.error.issues);
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
    console.log("[chat/api] messages is empty or not an array:", raw.messages);
    return new Response("messages must be a non-empty array", { status: 400 });
  }

  // Log last user message for debugging
  const lastMsg = uiMessages[uiMessages.length - 1];
  if (lastMsg) {
    const textParts = (lastMsg.parts ?? []).filter(
      (p): p is TextPart => p.type === "text",
    );
    console.log(
      "[chat/api] Last user message:",
      textParts.map((p) => p.text).join("").slice(0, 200),
    );
  }

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

  console.log("[chat/api] Thread found, starting stream with model:", modelId);

  const { client, tools } = await getCorsairToolsForTenant(userId);
  console.log(
    "[chat/api] MCP tools available:",
    Object.keys(tools),
  );

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
    onFinish: async ({ response, usage }) => {
      console.log("[chat/api] Stream finished. Usage:", usage);
      responseModel = response.modelId ?? modelId;
      const messages = await response.messages;
      responseMessages = (messages ?? []).map((m) =>
        JSON.parse(JSON.stringify(m)),
      ) as unknown[];

      // Log all tool calls from the final response
      for (const msg of responseMessages) {
        const m = msg as { role?: string; content?: unknown[] };
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const part of m.content) {
            const p = part as { type?: string; toolName?: string; toolCallId?: string; args?: unknown; result?: unknown };
            if (p.type === "tool-call") {
              console.log("[chat/api] Final tool call in response:", {
                toolName: p.toolName,
                toolCallId: p.toolCallId,
                args: JSON.stringify(p.args).slice(0, 300),
              });
            }
            if (p.type === "tool-result") {
              console.log("[chat/api] Final tool result in response:", {
                toolCallId: p.toolCallId,
                result: JSON.stringify(p.result).slice(0, 300),
              });
            }
          }
        }
      }

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
        console.log("[chat/api] Assistant message persisted");
      } catch (err) {
        console.error("[chat] failed to persist assistant message", err);
      }

      // Close MCP client AFTER stream is fully consumed
      try {
        await client.close();
        console.log("[chat/api] MCP client closed successfully");
      } catch (err) {
        console.error("[chat/api] Failed to close MCP client:", err);
      }
    },
    onError: ({ error }) => {
      console.error("[chat/api] Stream error:", error);
      // Also close client on error
      client.close().catch(() => {});
    },
  });

  const streamResponse = result.toUIMessageStreamResponse({
    onError: (err) => (err instanceof Error ? err.message : "Unknown error"),
    generateMessageId: () => assistantMessageId,
  });

  streamResponse.headers.set("x-cosmos-assistant-id", assistantMessageId);

  return streamResponse;
}
