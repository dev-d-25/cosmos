"use client";

import { useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import { QUICK_ACTIONS } from "./quick-actions";
import type { UIMessage } from "@ai-sdk/react";

interface ChatWindowProps {
  messages: UIMessage[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSend?: (text: string) => void;
  status: string;
  stop: () => void;
  disabled?: boolean;
}

export function ChatWindow({
  messages,
  input,
  setInput,
  onSubmit,
  onSend,
  status,
  stop,
  disabled,
}: ChatWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (status === "ready" || status === "error") {
      scrollToBottom();
    }
  }, [status, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  const isStreaming = status === "streaming" || status === "submitted";
  const hasMessages = messages.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Messages area - relative flex-1, scroll area fills this */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Empty state */}
        {messages.length === 0 && !isStreaming && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <ChatEmptyState
              onQueryClick={(query) => {
                setInput(query);
              }}
              onSend={(text) => {
                if (onSend) {
                  onSend(text);
                }
              }}
            />
          </div>
        )}

        {/* Messages scroll area - absolute fill within this relative container */}
        <div
          className={`absolute inset-0 touch-pan-y overflow-y-auto ${hasMessages ? "bg-background" : "bg-transparent"}`}
          ref={containerRef}
        >
          <div className="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role as "user" | "assistant" | "system"}
                parts={message.parts}
                isStreaming={isStreaming}
                incomplete={Boolean(
                  (message as { metadata?: { incomplete?: boolean } })
                    .metadata?.incomplete,
                )}
              />
            ))}

            {/* Thinking indicator */}
            {isStreaming &&
              messages.length > 0 &&
              messages[messages.length - 1]?.role === "user" && (
                <div className="group/message w-full" data-role="assistant">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-[13px] font-medium">Agent</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">
                        <div className="bg-muted/60 text-muted-foreground ring-border/50 flex size-7 shrink-0 items-center justify-center rounded-none ring-1">
                          <span className="text-xs font-medium">✦</span>
                        </div>
                      </div>
                      <span className="text-muted-foreground text-[13px]">
                        <span className="animate-[pulse_1s_ease-in-out_infinite]">▊</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

            <div className="min-h-[24px] min-w-[24px] shrink-0" ref={endRef} />
          </div>
        </div>

        {/* Scroll to bottom button */}
        <button
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-none border border-border/50 bg-card/90 px-3.5 text-[10px] shadow-md backdrop-blur-lg transition-all duration-200 hover:bg-card"
          onClick={() => scrollToBottom("smooth")}
          type="button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
      </div>

{/* Composer - sibling of messages area, not inside it */}
       <div className="shrink-0 mx-auto w-full max-w-3xl bg-background px-2 pt-2 pb-2 md:px-4 md:pt-3 md:pb-3">
         <ChatComposer
           input={input}
           setInput={setInput}
           onSubmit={onSubmit}
           status={status}
           stop={stop}
           disabled={disabled}
         />
        {/* Quick action buttons */}
        {!isStreaming && messages.length === 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  setInput(action.prompt);
                }}
                className="border-border/50 bg-card/30 hover:bg-card/60 hover:text-foreground rounded-none border px-3.5 py-1.5 text-[12px] leading-relaxed text-muted-foreground transition-all duration-200"
              >
                <span className="mr-1.5 inline-block text-[13px]">{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
