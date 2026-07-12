"use client";

import { useState } from "react";
import { ChevronDownIcon, WrenchIcon, CheckCircle2, XCircle, Loader2, Mail, Calendar, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

interface ToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const TOOL_LABELS: Record<string, string> = {
  "corsair_setup": "Connecting to Gmail & Calendar",
  "list_operations": "Listing available operations",
  "get_schema": "Fetching operation schema",
  "run_script": "Running script",
};

function getToolName(part: ToolPart): string {
  if (part.type === "dynamic-tool") {
    return part.toolName ?? "unknown";
  }
  return part.type.replace(/^tool-/, "");
}

function getToolLabel(part: ToolPart): string {
  const name = getToolName(part);
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function getToolIcon(part: ToolPart) {
  const name = getToolName(part);
  if (name.includes("gmail") || name.includes("mail") || name.includes("send") || name.includes("email")) {
    return <Mail className="size-3.5" />;
  }
  if (name.includes("calendar") || name.includes("event") || name.includes("schedule")) {
    return <Calendar className="size-3.5" />;
  }
  if (name.includes("label")) {
    return <Tag className="size-3.5" />;
  }
  return <WrenchIcon className="size-3.5" />;
}

export function ChatToolPart({ part }: { part: ToolPart }) {
  const [isOpen, setIsOpen] = useState(false);
  const isComplete = part.state === "output-available";
  const isError = part.state === "output-error";
  const isActive =
    part.state === "input-streaming" || part.state === "input-available";

  const label = getToolLabel(part);
  const icon = getToolIcon(part);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-none border border-border/50 bg-muted/20 text-xs">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 select-none">
          <span className="text-muted-foreground shrink-0">
            {isActive ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isComplete ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : isError ? (
              <XCircle className="size-3.5 text-destructive" />
            ) : (
              icon
            )}
          </span>
          <span className="text-foreground/80 min-w-0 flex-1 truncate text-left">
            {label}
          </span>
          <Badge
            variant={isError ? "destructive" : "secondary"}
            className="shrink-0 text-[10px]"
          >
            {isComplete ? "Done" : isError ? "Error" : isActive ? "Running" : "Pending"}
          </Badge>
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border/30 px-3 py-2">
            {part.input != null && (
              <div>
                <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">
                  Input
                </p>
                <pre className="bg-background/50 overflow-x-auto rounded-none p-2 font-mono text-[11px]">
                  <code>{typeof part.input === "string" ? part.input : JSON.stringify(part.input, null, 2)}</code>
                </pre>
              </div>
            )}
            {part.output != null && (
              <div>
                <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">
                  Output
                </p>
                <pre className="bg-background/50 max-h-[200px] overflow-auto rounded-none p-2 font-mono text-[11px]">
                  <code>
                    {typeof part.output === "string"
                      ? part.output
                      : JSON.stringify(part.output, null, 2)}
                  </code>
                </pre>
              </div>
            )}
            {isError && part.errorText && (
              <p className="text-destructive text-xs">{part.errorText}</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
