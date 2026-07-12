"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatPanelProvider, useChatPanel } from "@/components/chat/chat-panel-provider";
import { ChatThreadsList } from "@/components/chat/chat-threads-list";
import { AIElementsChatWindow as ChatWindow } from "@/components/chat/ai-elements-chat-window";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";
import { useChat } from "@/hooks/use-chat";
import {
  useChatThreads,
  useChatThread,
  useCreateThread,
  useDeleteThread,
  usePersistUserMessage,
  chatKeys,
} from "@/hooks/use-chat-threads";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TopBar } from "@/components/top-bar";
import { PanelLeftIcon, PenSquareIcon } from "lucide-react";
import {
  convertDbMessagesToUIMessages,
} from "@/lib/chat/message-converter";
import type { UIMessage } from "@ai-sdk/react";

function AgentInner() {
  const router = useRouter();
  const {
    activeThreadId,
    setActiveThreadId,
    startNewThread,
    model,
    setModel,
    reasoningEffort,
  } = useChatPanel();

  const hasInitializedFromUrl = useRef(false);
  useEffect(() => {
    if (hasInitializedFromUrl.current) return;
    hasInitializedFromUrl.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlThreadId = params.get("thread");
    if (urlThreadId) {
      setActiveThreadId(urlThreadId);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeThreadId) {
      params.set("thread", activeThreadId);
    } else {
      params.delete("thread");
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/agent?${qs}` : "/agent");
  }, [activeThreadId]);

  const threadsQuery = useChatThreads();
  const threadQuery = useChatThread(activeThreadId);
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const persistMessage = usePersistUserMessage();

  const threads = threadsQuery.data ?? [];
  const threadMessages = threadQuery.data?.messages ?? [];

  const chat = useChat(activeThreadId, model, reasoningEffort);
  const queryClient = useQueryClient();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Invalidate thread query when stream ends so DB-fetched messages include
  // the assistant message that was just persisted server-side.
  const prevStatusRef = useRef(chat.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = chat.status;
    if (
      activeThreadId &&
      (prev === "streaming" || prev === "submitted") &&
      chat.status !== "streaming" &&
      chat.status !== "submitted"
    ) {
      queryClient.invalidateQueries({
        queryKey: chatKeys.thread(activeThreadId),
      });
    }
  }, [chat.status, activeThreadId, queryClient]);

  const convertedThreadMessages = useMemo(
    () => convertDbMessagesToUIMessages(threadMessages),
    [threadMessages],
  );

  const onSubmit = useCallback(
    async () => {
      if (!input.trim()) return;
      if (chat.status === "streaming" || chat.status === "submitted") return;

      let threadId = activeThreadId;

      if (!threadId) {
        const newThread = await createThread.mutateAsync({
          model,
          title: input.slice(0, 80),
        });
        threadId = newThread.id;
        setActiveThreadId(threadId);
      }

      try {
        await chat.sendWithPersist(input, {
          persistMessage: persistMessage.mutateAsync,
          threadId: threadId!,
        });
        setInput("");
      } catch (err) {
        console.error("[agent] onSubmit failed:", err);
      }
    },
    [
      input,
      activeThreadId,
      model,
      chat,
      createThread,
      setActiveThreadId,
      persistMessage,
    ],
  );

  const handleNewThread = useCallback(async () => {
    console.log("[agent] handleNewThread: creating new thread in DB");
    try {
      const newThread = await createThread.mutateAsync({
        model,
        title: "New chat",
      });
      setActiveThreadId(newThread.id);
      setInput("");
    } catch (err) {
      console.error("[agent] handleNewThread failed:", err);
      toast.error("Failed to create new thread");
    }
  }, [createThread, model, setActiveThreadId]);

  const handleDeleteThread = useCallback(
    (id: string) => {
      deleteThread.mutate(id);
      if (activeThreadId === id) {
        startNewThread();
      }
    },
    [deleteThread, activeThreadId, startNewThread],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      if (
        activeThreadId &&
        (chat.status === "streaming" || chat.status === "submitted")
      ) {
        chat.stop();
      }
      setActiveThreadId(id);
    },
    [activeThreadId, chat, setActiveThreadId],
  );

  const handleSendDirect = useCallback(
    async (text: string) => {
      if (chat.status === "streaming" || chat.status === "submitted") return;

      let threadId = activeThreadId;

      if (!threadId) {
        const newThread = await createThread.mutateAsync({
          model,
          title: text.slice(0, 80),
        });
        threadId = newThread.id;
        setActiveThreadId(threadId);
      }

      try {
        await chat.sendWithPersist(text, {
          persistMessage: persistMessage.mutateAsync,
          threadId: threadId!,
        });
      } catch (err) {
        console.error("[agent] handleSendDirect failed:", err);
      }
    },
    [activeThreadId, model, chat, createThread, setActiveThreadId, persistMessage],
  );

  const isStreaming = chat.status === "streaming" || chat.status === "submitted";

  const allMessages = useMemo(() => {
    const getText = (parts: unknown[]): string =>
      (parts as { type: string; text?: string }[])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");

    // Merge DB history with live AI SDK messages.
    // Dedup by both ID and content fingerprint to avoid duplicates.
    if (chat.messages.length > 0) {
      // Build sets of IDs and fingerprints from live AI SDK state
      const liveIds = new Set(chat.messages.map((m) => m.id));
      const liveFingerprints = new Set(
        chat.messages.map((m) => `${m.role}:${getText(m.parts)}`),
      );

      // DB messages that are NOT already in chat.messages (by ID or content)
      const historical = convertedThreadMessages.filter((m) => {
        if (liveIds.has(m.id)) return false;
        const fp = `${m.role}:${getText(m.parts)}`;
        return !liveFingerprints.has(fp);
      });

      return [...historical, ...chat.messages];
    }
    // Initial load before AI SDK initializes: fall back to DB data.
    return convertedThreadMessages;
  }, [chat.messages, convertedThreadMessages]);

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <TopBar
        onSearchOpen={() => router.push("/search")}
      />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div
          className={`border-border flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ${
            sidebarOpen ? "w-64" : "w-0"
          } overflow-hidden`}
        >
          <div className="flex h-full w-64 flex-col overflow-hidden">
            {/* New chat button */}
            <div className="p-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleNewThread}
                disabled={isStreaming}
              >
                <PenSquareIcon className="size-4" />
                <span className="text-[13px]">New chat</span>
              </Button>
            </div>

            {/* Thread list */}
            <ScrollArea className="flex-1 overflow-hidden">
              <ChatThreadsList
                threads={threads}
                activeThreadId={activeThreadId}
                onSelect={handleSelectThread}
                onDelete={handleDeleteThread}
              />
            </ScrollArea>

            {/* Footer */}
            <div className="border-border border-t p-2">
              <ChatModelPicker value={model} onChange={setModel} />
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Chat header */}
          <div className="border-border flex h-9 shrink-0 items-center gap-2 border-b px-3">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    disabled={isStreaming}
                  />
                }
              >
                <PanelLeftIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{sidebarOpen ? "Close sidebar" : "Open sidebar"}</TooltipContent>
            </Tooltip>
            <h2 className="truncate text-sm font-medium">
              {activeThreadId
                ? threads.find((t) => t.id === activeThreadId)?.title ?? "Chat"
                : "New Conversation"}
            </h2>
          </div>

          <ChatWindow
            messages={allMessages}
            input={input}
            setInput={setInput}
            onSubmit={onSubmit}
            onSend={handleSendDirect}
            status={chat.status}
            stop={chat.stop}
            disabled={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}

export function AgentClient() {
  return (
    <ChatPanelProvider>
      <AgentInner />
    </ChatPanelProvider>
  );
}
