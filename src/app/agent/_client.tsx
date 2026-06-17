"use client";

import { useState, useCallback, useMemo } from "react";
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
import type { UIMessage } from "@ai-sdk/react";

function convertDbMessagesToUIMessages(dbMessages: unknown[]): UIMessage[] {
  const result: UIMessage[] = [];
  for (const raw of dbMessages) {
    const msg = raw as {
      id: string;
      role: string;
      parts: unknown;
      model?: string | null;
    };

    if (msg.role === "user") {
      result.push({
        id: msg.id,
        role: "user",
        parts: Array.isArray(msg.parts) ? msg.parts : [],
      } as UIMessage);
      continue;
    }

    if (msg.role === "assistant") {
      const uiParts: UIMessage["parts"] = [];
      const modelMsgs = Array.isArray(msg.parts) ? msg.parts : [];

      for (const m of modelMsgs) {
        const mm = m as { role?: string; content?: unknown[] };
        if (!Array.isArray(mm.content)) continue;
        for (const c of mm.content) {
          const part = c as Record<string, unknown>;
          if (part.type === "text" && typeof part.text === "string") {
            uiParts.push({ type: "text", text: part.text } as UIMessage["parts"][number]);
          } else if (part.type === "tool-call") {
            uiParts.push({
              type: `tool-${part.toolName}`,
              toolCallId: part.toolCallId,
              state: "output-available",
              input: part.args ?? part.input,
              output: undefined,
            } as UIMessage["parts"][number]);
          }
        }
        if (mm.role === "tool" && Array.isArray(mm.content)) {
          for (const c of mm.content) {
            const part = c as Record<string, unknown>;
            if (part.type === "tool-result") {
              uiParts.push({
                type: `tool-${part.toolName ?? "unknown"}`,
                toolCallId: part.toolCallId,
                state: "output-available",
                input: undefined,
                output: part.result ?? part.output,
              } as UIMessage["parts"][number]);
            }
          }
        }
      }

      if (uiParts.length === 0) {
        uiParts.push({ type: "text", text: "" } as UIMessage["parts"][number]);
      }

      result.push({
        id: msg.id,
        role: "assistant",
        parts: uiParts,
      } as UIMessage);
      continue;
    }

    result.push({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "system",
      parts: Array.isArray(msg.parts) ? msg.parts : [],
    } as UIMessage);
  }
  return result;
}

function AgentInner() {
  const router = useRouter();
  const {
    activeThreadId,
    setActiveThreadId,
    startNewThread,
    model,
    setModel,
  } = useChatPanel();

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

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;

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
      chat.setMessages([]);
    } catch (err) {
      console.error("[agent] handleNewThread failed:", err);
      toast.error("Failed to create new thread");
    }
  }, [createThread, model, setActiveThreadId, chat]);

  const handleDeleteThread = useCallback(
    (id: string) => {
      deleteThread.mutate(id);
      if (activeThreadId === id) {
        startNewThread();
        chat.setMessages([]);
      }
    },
    [deleteThread, activeThreadId, startNewThread, chat],
  );

  const handleSendDirect = useCallback(
    async (text: string) => {
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

  const convertedThreadMessages = useMemo(
    () => convertDbMessagesToUIMessages(threadMessages),
    [threadMessages],
  );

  const allMessages = useMemo(() => {
    if (chat.messages.length > 0) return chat.messages;
    return convertedThreadMessages;
  }, [chat.messages, convertedThreadMessages]);

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
                onSelect={(id) => {
                  setActiveThreadId(id);
                  chat.setMessages([]);
                }}
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
