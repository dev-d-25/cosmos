"use client";

import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  status: string;
  stop: () => void;
  disabled?: boolean;
  className?: string;
}

export function ChatComposer({
  input,
  setInput,
  onSubmit,
  status,
  stop,
  disabled,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          stop();
        } else if (input.trim()) {
          onSubmit(e as unknown as React.FormEvent);
        }
      }
    },
    [isStreaming, stop, input, onSubmit],
  );

  return (
    <div className={cn("", className)}>
      <div className="bg-muted/50 border-border relative rounded-xl border shadow-sm">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          rows={1}
          disabled={disabled}
          className="min-h-[36px] max-h-[160px] w-full resize-none bg-transparent px-3 py-2 pr-10 text-[13px] leading-[1.5] outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="absolute right-1.5 bottom-1.5">
          {isStreaming ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="size-7 rounded-lg"
              onClick={stop}
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              disabled={!input.trim() || disabled}
              className="size-7 rounded-lg"
              onClick={() => {
                if (input.trim()) {
                  onSubmit({ preventDefault: () => {} } as React.FormEvent);
                }
              }}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
