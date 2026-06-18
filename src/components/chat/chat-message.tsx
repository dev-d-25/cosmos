"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "./chat-markdown";
import { ChatToolPart } from "./chat-tool-part";
import { ChatMessageActions } from "./chat-message-actions";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Shimmer } from "./shimmer";
import { format } from "date-fns";
import { AlertTriangleIcon } from "lucide-react";

interface MessagePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  isStreaming?: boolean;
  createdAt?: Date;
  incomplete?: boolean;
}

export function ChatMessage({ role, parts, isStreaming, createdAt, incomplete }: ChatMessageProps) {
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  const reasoning = useMemo(() => {
    return parts.reduce(
      (acc, part) => {
        if (part.type === "reasoning" && part.text && part.text.trim().length > 0) {
          return {
            text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
            isStreaming: "state" in part ? (part as { state: string }).state === "streaming" : false,
          };
        }
        return acc;
      },
      { text: "", isStreaming: false },
    );
  }, [parts]);

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]",
      )}
      data-role={role}
    >
      {isAssistant ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-primary text-[13px] font-medium">Agent</span>
            {createdAt && (
              <span className="text-muted-foreground text-[11px]">{format(createdAt, "h:mm a")}</span>
            )}
            {incomplete && (
              <span
                className="text-muted-foreground inline-flex items-center gap-1 text-[11px]"
                title="The assistant was interrupted before finishing this reply."
              >
                <AlertTriangleIcon className="size-3" />
                <span>Generation stopped</span>
              </span>
            )}
          </div>
          <div className="flex items-start gap-3">
            <div className="pt-0.5">
              <div className="bg-muted/60 text-muted-foreground ring-border/50 flex size-7 shrink-0 items-center justify-center rounded-none ring-1">
                <span className="text-xs font-medium">✦</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {reasoning.text && (
                <MessageReasoning
                  isLoading={!!isStreaming && reasoning.isStreaming}
                  reasoning={reasoning.text}
                />
              )}
              {parts.map((part, i) => renderPart(part, i, isStreaming, false))}
              <ChatMessageActions parts={parts} className="-ml-0.5" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-primary text-[13px] font-medium">You</span>
            {createdAt && (
              <span className="text-muted-foreground text-[11px]">{format(createdAt, "h:mm a")}</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {parts.map((part, i) => renderPart(part, i, isStreaming, true))}
            <ChatMessageActions parts={parts} className="-mr-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}

function MessageReasoning({
  isLoading,
  reasoning,
}: {
  isLoading: boolean;
  reasoning: string;
}) {
  const [isOpen, setIsOpen] = useState(isLoading);
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  useEffect(() => {
    if (hasBeenStreaming && !isLoading && isOpen) {
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [hasBeenStreaming, isLoading, isOpen]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-muted-foreground text-[13px] leading-[1.65] transition-colors hover:text-foreground">
        {isLoading ? (
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        ) : (
          <span>
            Thought for {Math.ceil(reasoning.length / 40)} seconds
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("size-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 text-muted-foreground/60 [overflow-anchor:none]">
          <div
            className="max-h-[200px] overflow-y-auto rounded-none border border-border/20 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            <ChatMarkdown text={reasoning} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function renderPart(
  part: MessagePart,
  i: number,
  isStreaming: boolean | undefined,
  isUser: boolean,
) {
  if (part.type === "text" && part.text) {
    if (isUser) {
      return (
        <div
          key={i}
          className="w-fit max-w-[min(80%,56ch)] break-words rounded-none border border-border/40 bg-secondary px-4 py-2.5 text-[13px] leading-[1.65] shadow-sm"
        >
          {part.text}
        </div>
      );
    }

    return (
      <div
        key={i}
        className="text-[13px] leading-[1.65]"
      >
        <ChatMarkdown
          text={part.text}
          isAnimating={isStreaming && i > -1}
        />
      </div>
    );
  }

  if (part.type === "reasoning") {
    return null;
  }

  if (part.type?.startsWith("tool-")) {
    return <ChatToolPart key={part.toolCallId ?? i} part={part} />;
  }

  if (part.type === "source-url" && part.input) {
    const input = part.input as { url?: string; title?: string };
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
}
