"use client";

import { useEffect, useState, useMemo } from "react";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import {
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { ChatMarkdown } from "./chat-markdown";
import { ChatToolPart } from "./chat-tool-part";
import { ChatEmptyState } from "./chat-empty-state";
import { QUICK_ACTIONS } from "./quick-actions";
import { Copy, Check, Loader2 } from "lucide-react";
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

interface MessagePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      tooltip={copied ? "Copied!" : "Copy"}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </MessageAction>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block size-1.5 rounded-full bg-current"
          style={{
            animation: "thinking-bounce 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

function AgentAvatar() {
  return (
    <div className="pt-0.5">
      <div className="bg-muted/60 text-muted-foreground ring-border/50 flex size-7 shrink-0 items-center justify-center ring-1">
        <span className="text-xs font-medium">✦</span>
      </div>
    </div>
  );
}

function isToolPart(p: MessagePart | undefined): boolean {
  if (!p) return false;
  if (p.type === "dynamic-tool") return true;
  return p.type?.startsWith("tool-") === true;
}

function getToolNameFromPart(p: MessagePart): string {
  if (p.type === "dynamic-tool") {
    return (p as MessagePart & { toolName?: string }).toolName ?? "unknown";
  }
  return p.type?.replace(/^tool-/, "") ?? "unknown";
}

function getToolStatusFromParts(parts: MessagePart[]): {
  activeTool: string | null;
  completedCount: number;
  activeCount: number;
} {
  const toolParts = parts.filter(isToolPart);
  const active = toolParts.filter(
    (p) => p?.state === "input-streaming" || p?.state === "input-available",
  );
  const completed = toolParts.filter((p) => p?.state === "output-available");

  if (active.length > 0 && active[0]) {
    const name = getToolNameFromPart(active[0]).replace(/_/g, " ");
    return {
      activeTool: name,
      completedCount: completed.length,
      activeCount: active.length,
    };
  }
  return { activeTool: null, completedCount: completed.length, activeCount: 0 };
}

export function AIElementsChatWindow({
  messages,
  input,
  setInput,
  onSubmit,
  onSend,
  status,
  stop,
  disabled,
}: ChatWindowProps) {
  const { containerRef, endRef, scrollToBottom } = useScrollToBottom();
  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text.trim()) {
      onSubmit({ preventDefault: () => {} } as React.FormEvent);
    }
  };

  // Standalone thinking block: show BEFORE assistant message exists
  const showThinkingIndicator = useMemo(() => {
    if (!isStreaming) return false;
    const lastMsg = messages[messages.length - 1];
    const lastRole = lastMsg?.role;
    // No assistant message yet (only user/system messages) → standalone block
    if (!lastMsg || lastRole !== "assistant") return true;
    return false;
  }, [messages, isStreaming]);

  // Get tool status from all assistant messages
  const toolStatus = useMemo(() => {
    const allParts = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => ((m.parts ?? []) as MessagePart[]));
    return getToolStatusFromParts(allParts);
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Empty state */}
        {messages.length === 0 && !isStreaming && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <ChatEmptyState
              onQueryClick={(q) => setInput(q)}
              onSend={(t) => onSend?.(t)}
            />
          </div>
        )}

        {/* Messages scroll area */}
        <div
          className={`absolute inset-0 touch-pan-y overflow-y-auto ${messages.length > 0 ? "bg-background" : "bg-transparent"}`}
          ref={containerRef}
        >
          <div className="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4">
            {messages.map((message, msgIdx) => {
              const role = message.role as "user" | "assistant" | "system";
              const parts = (message.parts ?? []) as MessagePart[];
              const isLastMessage = msgIdx === messages.length - 1;

              // Extract reasoning
              const reasoning = parts.reduce(
                (acc, part) => {
                  if (
                    part?.type === "reasoning" &&
                    part.text &&
                    part.text.trim().length > 0
                  ) {
                    return {
                      text: acc.text
                        ? `${acc.text}\n\n${part.text}`
                        : part.text,
                      isStreaming:
                        "state" in part
                          ? (part as { state: string }).state === "streaming"
                          : false,
                    };
                  }
                  return acc;
                },
                { text: "", isStreaming: false },
              );

              // Extract text for copy
              const textForCopy = parts
                .filter((p) => p?.type === "text")
                .map((p) => p.text)
                .join("\n")
                .trim();

              if (role === "user") {
                return (
                  <div key={message.id} className="group w-full" data-role="user">
                    <div className="flex flex-col items-end gap-1">
                      {parts.map((part, i) => {
                        if (part?.type === "text" && part.text) {
                          return (
                            <div
                              key={i}
                              className="w-fit max-w-[min(80%,56ch)] break-words rounded-none border border-border/40 bg-secondary px-4 py-2.5 text-[13px] leading-[1.65] shadow-sm"
                            >
                              {part.text}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                );
              }

              // Assistant / system
              const hasAnyContent = parts.some(
                (p) =>
                  (p?.type === "text" && p.text && p.text.trim().length > 0) ||
                  isToolPart(p),
              );
              const toolInfo = getToolStatusFromParts(parts);

              return (
                <div key={message.id} className="group w-full" data-role={role}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-[13px] font-medium">
                        {role === "assistant" ? "Agent" : role}
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      {role === "assistant" && <AgentAvatar />}
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        {/* Reasoning */}
                        {reasoning.text && (
                          <Reasoning isStreaming={reasoning.isStreaming}>
                            <ReasoningTrigger />
                            <ReasoningContent>
                              {reasoning.text}
                            </ReasoningContent>
                          </Reasoning>
                        )}

                        {/* Tool status indicator — shows when tools are active */}
                        {role === "assistant" && isLastMessage && isStreaming && toolInfo.activeTool && (
                          <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
                            <Loader2 className="size-3.5 animate-spin" />
                            <span className="text-muted-foreground/70">
                              Running {toolInfo.activeTool}
                              {toolInfo.activeCount + toolInfo.completedCount > 1
                                ? ` (+${toolInfo.activeCount + toolInfo.completedCount - 1} more)`
                                : ""}
                              ...
                            </span>
                          </div>
                        )}

                        {/* Parts */}
                        {parts.map((part, i) => {
                          if (!part) return null;
                          if (part.type === "text" && part.text) {
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="text-[13px] leading-[1.65]"
                              >
                                <ChatMarkdown text={part.text} />
                              </div>
                            );
                          }
                          if (part.type === "reasoning") {
                            return null;
                          }
                          if (isToolPart(part)) {
                            return (
                              <ChatToolPart
                                key={part.toolCallId ?? `${message.id}-tool-${i}`}
                                part={part}
                              />
                            );
                          }
                          if (part.type === "source-url" && part.input) {
                            const input = part.input as {
                              url?: string;
                              title?: string;
                            };
                            return (
                              <a
                                key={i}
                                href={input.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
                              >
                                {input.title ?? input.url}
                              </a>
                            );
                          }
                          return null;
                        })}

                        {/* Thinking indicator — inside assistant message when no content yet */}
                        {role === "assistant" && isLastMessage && isStreaming &&
                          !hasAnyContent && !toolInfo.activeTool && (
                          <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
                            <ThinkingDots />
                            <span className="text-muted-foreground/70">Thinking</span>
                          </div>
                        )}

                        {/* Actions */}
                        {role === "assistant" && textForCopy && (
                          <MessageActions>
                            <CopyButton text={textForCopy} />
                          </MessageActions>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Thinking indicator — standalone block BEFORE assistant message exists */}
            {showThinkingIndicator && (
              <div className="group w-full" data-role="assistant">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-primary text-[13px] font-medium">
                      Agent
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <AgentAvatar />
                    <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
                      <ThinkingDots />
                      <span className="text-muted-foreground/70">Thinking</span>
                    </div>
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

      {/* Composer */}
      <div className="chat-composer shrink-0 mx-auto w-full max-w-3xl bg-background px-2 pt-2 pb-4 md:px-4 md:pt-3 md:pb-5">
        <PromptInput onSubmit={handleSubmit} className="relative">
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Message..."
            className="pr-12 pl-4"
          />
          <div className="absolute right-1.5 bottom-2 flex items-center">
            <PromptInputSubmit
              status={
                isStreaming
                  ? (status as "streaming" | "submitted")
                  : "ready"
              }
              onStop={stop}
              disabled={!isStreaming && !input.trim()}
            />
          </div>
        </PromptInput>

        {/* Quick actions */}
        {!isStreaming && messages.length === 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => setInput(action.prompt)}
                className="border-border/50 bg-card/30 hover:bg-card/60 hover:text-foreground rounded-none border px-3.5 py-1.5 text-[12px] leading-relaxed text-muted-foreground transition-all duration-200"
              >
                <span className="mr-1.5 inline-block text-[13px]">
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
