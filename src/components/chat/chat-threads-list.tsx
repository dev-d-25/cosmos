"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Trash2Icon, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatThread } from "@/types/chat";

interface ChatThreadsListProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatTime(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function ChatThreadsList({
  threads,
  activeThreadId,
  onSelect,
  onDelete,
}: ChatThreadsListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          Threads
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 px-1">
          {threads.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-center text-xs">
              No conversations yet
            </p>
          )}
          {threads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => onSelect(thread.id)}
              className={cn(
                "group flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                activeThreadId === thread.id
                  ? "bg-accent"
                  : "hover:bg-accent/50",
              )}
            >
              <MessageSquare className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{thread.title}</p>
                <p className="text-muted-foreground text-[10px]">
                  {formatTime(thread.updatedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(thread.id);
                }}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
