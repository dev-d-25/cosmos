"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

const plugins = { cjk, code, math, mermaid };

export const ChatMarkdown = memo(
  function ChatMarkdown({ text, className, isAnimating }: { text: string; className?: string; isAnimating?: boolean }) {
    return (
      <div
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none overflow-hidden break-words [word-break:break-word]",
          className,
        )}
      >
        <Streamdown
          isAnimating={isAnimating}
          className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          components={{ p: "div" }}
          plugins={plugins}
        >
          {text}
        </Streamdown>
      </div>
    );
  },
  (prev, next) => prev.text === next.text && prev.className === next.className && prev.isAnimating === next.isAnimating,
);
