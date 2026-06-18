import type { UIMessage } from "ai";

type DbMessageRow = {
  id: string;
  role: string;
  parts: unknown;
  model?: string | null;
  incomplete?: boolean;
  finishReason?: string | null;
  createdAt?: Date | string | null;
};

export function isModelMessageFormat(parts: unknown[]): boolean {
  if (parts.length === 0) return false;
  const first = parts[0] as Record<string, unknown>;
  return (
    typeof first === "object" &&
    first !== null &&
    "role" in first &&
    "content" in first
  );
}

function buildMetadata(
  row: DbMessageRow,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (row.incomplete) meta.incomplete = true;
  if (row.finishReason) meta.finishReason = row.finishReason;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function convertDbMessagesToUIMessages(
  dbMessages: unknown[],
): UIMessage[] {
  const result: UIMessage[] = [];
  for (const raw of dbMessages) {
    const msg = raw as DbMessageRow;

    if (msg.role === "user") {
      result.push({
        id: msg.id,
        role: "user",
        parts: Array.isArray(msg.parts)
          ? (msg.parts as UIMessage["parts"])
          : [],
        ...(msg.createdAt ? { createdAt: new Date(msg.createdAt) } : {}),
        ...(buildMetadata(msg) ? { metadata: buildMetadata(msg) } : {}),
      });
      continue;
    }

    if (msg.role === "assistant") {
      const partsArray = Array.isArray(msg.parts) ? msg.parts : [];

      // Legacy: rows written by the v4-era /api/chat/messages/assistant client
      // store parts in ModelMessage format. Detect and convert inline. After
      // migration 0002 this branch should be unreachable for fresh data, but
      // we keep it as a safety net for any rows that escape the conversion.
      const isLegacy = isModelMessageFormat(partsArray);
      const uiParts: UIMessage["parts"] = isLegacy
        ? convertLegacyModelMessagesToUIParts(partsArray)
        : (partsArray as UIMessage["parts"]);

      result.push({
        id: msg.id,
        role: "assistant",
        parts: uiParts.length > 0 ? uiParts : [{ type: "text", text: "" }],
        ...(msg.createdAt ? { createdAt: new Date(msg.createdAt) } : {}),
        ...(buildMetadata(msg) ? { metadata: buildMetadata(msg) } : {}),
      });
      continue;
    }

    result.push({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "system",
      parts: Array.isArray(msg.parts) ? (msg.parts as UIMessage["parts"]) : [],
      ...(msg.createdAt ? { createdAt: new Date(msg.createdAt) } : {}),
      ...(buildMetadata(msg) ? { metadata: buildMetadata(msg) } : {}),
    });
  }
  return result;
}

function convertLegacyModelMessagesToUIParts(
  partsArray: unknown[],
): UIMessage["parts"] {
  const uiParts: UIMessage["parts"] = [];
  for (const m of partsArray) {
    const mm = m as { role?: string; content?: unknown[] };
    if (!Array.isArray(mm.content)) continue;

    for (const c of mm.content) {
      const part = c as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        uiParts.push({
          type: "text",
          text: part.text,
          state: "done",
        } as UIMessage["parts"][number]);
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        uiParts.push({
          type: "reasoning",
          text: part.text,
          state: "done",
        } as UIMessage["parts"][number]);
      } else if (part.type === "tool-call") {
        uiParts.push({
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId as string,
          state: "input-available",
          input: part.args ?? part.input,
          output: undefined,
        } as UIMessage["parts"][number]);
      }
    }

    if (mm.role === "tool" && Array.isArray(mm.content)) {
      for (const c of mm.content) {
        const part = c as Record<string, unknown>;
        if (part.type === "tool-result") {
          uiParts.push({
            type: `tool-${(part.toolName as string) ?? "unknown"}`,
            toolCallId: part.toolCallId as string,
            state: "output-available",
            input: undefined,
            output: part.result ?? part.output,
          } as UIMessage["parts"][number]);
        }
      }
    }
  }
  return uiParts;
}
