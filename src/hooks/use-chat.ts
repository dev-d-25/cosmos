"use client";

import { useChat as useAiChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

export function useChat(threadId: string | null, model: string) {
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const modelRef = useRef(model);
  modelRef.current = model;

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    body: () => {
      const body = {
        threadId: threadIdRef.current,
        model: modelRef.current,
      };
      console.log("[chat] transport body:", body);
      return body;
    },
  });

  const chat = useAiChat({
    id: threadId ?? undefined,
    transport,
    onError: (err: Error) => {
      console.error("[chat] onError:", err);
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  // Use a ref to always access the latest sendMessage, avoiding stale closures
  const sendMessageRef = useRef(chat.sendMessage);
  sendMessageRef.current = chat.sendMessage;

  const sendWithPersist = useCallback(
    async (
      text: string,
      opts: {
        persistMessage: (body: {
          threadId: string;
          id: string;
          parts: unknown[];
        }) => Promise<unknown>;
        threadId: string;
      },
    ) => {
      // Force-ref the threadId so the transport body picks it up immediately
      threadIdRef.current = opts.threadId;
      console.log("[chat] sendWithPersist:", { text, threadId: opts.threadId });

      try {
        // Persist user message to DB so it survives refresh
        const id = crypto.randomUUID();
        await opts.persistMessage({
          threadId: opts.threadId,
          id,
          parts: [{ type: "text", text }],
        });
        console.log("[chat] message persisted to DB");
      } catch (err) {
        console.error("[chat] failed to persist message:", err);
        toast.error("Failed to save message. Please try again.");
        throw err;
      }

      // Send via AI SDK — use ref to avoid stale closure
      console.log("[chat] calling sendMessage, threadIdRef:", threadIdRef.current);
      sendMessageRef.current({ text });
    },
    [],
  );

  return {
    ...chat,
    sendWithPersist,
  };
}
