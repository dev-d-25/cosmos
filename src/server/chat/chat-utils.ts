export function sanitiseUIMessageParts(
  parts: unknown[],
  isAborted: boolean,
): unknown[] {
  if (!Array.isArray(parts)) return [];
  if (!isAborted) return parts;

  return parts.map((raw) => {
    const p = raw as {
      type?: string;
      state?: string;
      text?: string;
      toolCallId?: string;
      errorText?: string;
    };
    if (!p || typeof p !== "object" || typeof p.type !== "string") return raw;

    if (
      (p.type === "text" || p.type === "reasoning") &&
      p.state !== "done"
    ) {
      return { ...p, state: "done" };
    }

    if (p.type.startsWith("tool-") && p.state === "input-streaming") {
      return {
        ...p,
        state: "output-error",
        errorText: p.errorText ?? "Stream interrupted",
      };
    }

    return raw;
  });
}

export function hasIncompleteParts(parts: unknown[]): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((raw) => {
    const p = raw as { type?: string; state?: string };
    if (!p || typeof p !== "object" || typeof p.type !== "string") return false;
    if (p.type === "text" || p.type === "reasoning")
      return p.state !== "done";
    if (p.type.startsWith("tool-"))
      return p.state === "input-streaming" || p.state === "input-available";
    return false;
  });
}
