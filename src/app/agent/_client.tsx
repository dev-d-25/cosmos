"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatPanelProvider, useChatPanel } from "@/components/chat/chat-panel-provider";
import { ChatThreadsList } from "@/components/chat/chat-threads-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";
import { useChat } from "@/hooks/use-chat";
import {
  useChatThreads,
  useChatThread,
  useCreateThread,
  useDeleteThread,
  usePersistUserMessage,
} from "@/hooks/use-chat-threads";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MailTopNav } from "@/components/mail/mail-top-nav";
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

  const chat = useChat(activeThreadId, model);

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const convertedThreadMessages = useMemo(
    () => convertDbMessagesToUIMessages(threadMessages),
    [threadMessages],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
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
    if (isStreaming && chat.messages.length > 0) {
      return chat.messages;
    }
    if (convertedThreadMessages.length > 0) {
      return convertedThreadMessages;
    }
    return chat.messages;
  }, [chat.messages, convertedThreadMessages, isStreaming]);

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <MailTopNav
        syncedState="Synced"
        profile={null}
        onRefresh={() => {}}
        onClearCache={() => {}}
        isRefreshing={false}
        isClearing={false}
        onSearchOpen={() => router.push("/search")}
        shortcutsOpen={false}
        onShortcutsOpenChange={() => {}}
      />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div
          className={`border-border flex shrink-0 flex-col border-r transition-[width] duration-200 ${
            sidebarOpen ? "w-64" : "w-0"
          } overflow-hidden`}
        >
          <div className="flex h-full w-64 flex-col">
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
            <ScrollArea className="flex-1">
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
