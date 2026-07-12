import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

export const streamdownPlugins = { cjk, code, math, mermaid };

export interface ChatMessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function getToolName(part: {
  type: string;
  toolName?: string;
}): string {
  if (part.type === "dynamic-tool") {
    return part.toolName ?? "unknown";
  }
  return part.type.replace(/^tool-/, "");
}
