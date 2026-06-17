"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ChatMessageActionsProps {
  parts: { type: string; text?: string }[];
  className?: string;
}

export function ChatMessageActions({ parts, className }: ChatMessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const textFromParts = parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const handleCopy = useCallback(async () => {
    if (!textFromParts) return;

    await navigator.clipboard.writeText(textFromParts);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [textFromParts]);

  if (!textFromParts) return null;

  return (
    <div
      className={cn(
        "opacity-0 transition-opacity duration-150 group-hover/message:opacity-100",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/50 hover:text-foreground"
              onClick={handleCopy}
            />
          }
        >
          {copied ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          )}
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
