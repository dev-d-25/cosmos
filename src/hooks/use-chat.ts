"use client";

import { useChat as useAiChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

export function useChat(threadId: string | null, model: string) {
  const modelRef = useRef(model);
  modelRef.current = model;

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ id, messages }) => {
      return {
        body: {
          threadId: id,
          message: messages[messages.length - 1],
          model: modelRef.current,
        },
      };
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
      console.log("[chat] sendWithPersist:", { text, threadId: opts.threadId });

      try {
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

      console.log("[chat] calling sendMessage");
      sendMessageRef.current({ text });
    },
    [],
  );

  return {
    ...chat,
    sendWithPersist,
  };
}