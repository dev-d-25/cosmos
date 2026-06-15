import type { MailAttachment, MailListItem, MailMessage } from "./types";

export function getHeader(
  headers: { name?: string; value?: string }[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value;
}

export function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = normalized + "=".repeat(pad === 0 ? 0 : 4 - pad);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

export function extractBody(
  payload: { mimeType?: string; body?: { data?: string }; parts?: any[] } | undefined,
): { bodyHtml: string; bodyText: string } {
  if (!payload) return { bodyHtml: "", bodyText: "" };

  let bodyHtml = "";
  let bodyText = "";

  function walk(part: any): void {
    if (!part) return;
    const data = part.body?.data;
    const mimeType = part.mimeType;
    if (data && mimeType) {
      const decoded = decodeBase64Url(data);
      if (mimeType === "text/html" && !bodyHtml) bodyHtml = decoded;
      else if (mimeType === "text/plain" && !bodyText) bodyText = decoded;
    }
    if (Array.isArray(part.parts)) {
      for (const sub of part.parts) walk(sub);
    }
  }

  walk(payload);
  return { bodyHtml, bodyText };
}

export function getPartAttachments(
  payload: { parts?: any[]; mimeType?: string } | undefined,
): MailAttachment[] {
  if (!Array.isArray(payload?.parts)) return [];
  const attachments: MailAttachment[] = [];

  function walk(part: any): void {
    if (!part) return;
    if (
      typeof part.filename === "string" &&
      part.filename.trim() !== "" &&
      part.body?.attachmentId &&
      (typeof part.mimeType !== "string" || !part.mimeType.startsWith("multipart/"))
    ) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const sub of part.parts) {
        if (typeof sub.mimeType === "string" && sub.mimeType.startsWith("multipart/")) {
          for (const nested of (sub.parts ?? [])) walk(nested);
        } else {
          walk(sub);
        }
      }
    }
  }

  for (const part of payload.parts) walk(part);
  return attachments;
}

export function toListItem(row: { data: Record<string, unknown> }): MailListItem {
  const d = row.data;
  const internalDateRaw = d.internalDate as number | string | undefined;
  const receivedAt = internalDateRaw
    ? typeof internalDateRaw === "number"
      ? new Date(internalDateRaw).toISOString()
      : new Date(Number(internalDateRaw) || Date.now()).toISOString()
    : new Date().toISOString();

  const labelIds = (d.labelIds as string[] | undefined) ?? [];
  const id = (d.id as string | undefined) ?? "";
  const threadId = (d.threadId as string | undefined) ?? "";
  const subject = (d.subject as string | undefined) ?? (d.snippet as string | undefined) ?? "";
  const from = (d.from as string | undefined) ?? "";
  const snippet = (d.snippet as string | undefined) ?? "";

  return {
    id,
    threadId,
    subject,
    from,
    snippet,
    receivedAt,
    unread: labelIds.includes("UNREAD"),
    labelIds,
  };
}

export function toMailMessage(data: Record<string, unknown>): MailMessage {
  const payload = data.payload as { headers?: Array<{ name?: string; value?: string }>; mimeType?: string; body?: { data?: string }; parts?: any[] } | undefined;

  const subject = getHeader(payload?.headers, "Subject") ?? (data.subject as string | undefined) ?? "";
  const from = getHeader(payload?.headers, "From") ?? (data.from as string | undefined) ?? "";
  const to = getHeader(payload?.headers, "To") ?? (data.to as string | undefined) ?? "";
  const cc = getHeader(payload?.headers, "Cc") ?? "";
  const dateHeader = getHeader(payload?.headers, "Date");
  const date = dateHeader ?? null;
  const snippet = (data.snippet as string | undefined) ?? "";
  const { bodyHtml, bodyText } = extractBody(payload);
  const attachments = getPartAttachments(payload);

  const id = (data.id as string | undefined) ?? "";
  const threadId = (data.threadId as string | undefined) ?? "";
  const finalBodyHtml = bodyHtml || (data.bodyHtml as string | undefined) || "";
  const finalBodyText = bodyText || (data.bodyText as string | undefined) || "";

  return {
    id,
    threadId,
    subject,
    from,
    to,
    cc,
    date,
    snippet,
    bodyHtml: finalBodyHtml,
    bodyText: finalBodyText,
    attachments,
  };
}
