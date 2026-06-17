"use client";

import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

export function ChatMarkdown({
  text,
  isAnimating,
}: {
  text: string;
  isAnimating?: boolean;
}) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Streamdown
        isAnimating={isAnimating}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Streamdown>
    </div>
  );
}
