"use client";

import { ChevronDownIcon, WrenchIcon, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolPart {
  type: string;
  toolCallId?: string;
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

function getToolLabel(toolType: string): string {
  const name = toolType.replace(/^tool-/, "");
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function getToolIcon(toolType: string) {
  const name = toolType.replace(/^tool-/, "");
  if (name.includes("gmail") || name.includes("mail") || name.includes("send") || name.includes("email")) {
    return "📧";
  }
  if (name.includes("calendar") || name.includes("event") || name.includes("schedule")) {
    return "📅";
  }
  if (name.includes("label")) {
    return "🏷️";
  }
  return null;
}

export function ChatToolPart({ part }: { part: ToolPart }) {
  const isComplete = part.state === "output-available";
  const isError = part.state === "output-error";
  const isActive =
    part.state === "input-streaming" || part.state === "input-available";

  const label = getToolLabel(part.type);
  const emoji = getToolIcon(part.type);

  return (
    <details className="group rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 select-none">
        {isActive ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : isComplete ? (
          <CheckCircle2 className="size-3.5 text-green-500" />
        ) : isError ? (
          <XCircle className="size-3.5 text-destructive" />
        ) : (
          <WrenchIcon className="size-3.5 text-muted-foreground" />
        )}
        {emoji && <span className="text-xs">{emoji}</span>}
        <code className="font-medium">{label}</code>
        <span className="text-muted-foreground ml-auto text-[10px]">
          {isComplete ? "Done" : isError ? "Error" : isActive ? "Running..." : "Pending"}
        </span>
        <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-2">
        {part.input != null && (
          <div>
            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">
              Input
            </p>
            <pre className="bg-background/50 overflow-x-auto rounded p-2 text-[11px]">
              <code>{JSON.stringify(part.input, null, 2)}</code>
            </pre>
          </div>
        )}
        {part.output != null && (
          <div>
            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">
              Output
            </p>
            <pre className="bg-background/50 overflow-x-auto rounded p-2 text-[11px]">
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
    </details>
  );
}
