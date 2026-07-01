"use server";

import { getSessionTenantId, getAccountIdForTenant } from "@/server/connected-account";
import { corsair } from "@/server/corsair";
import { invalidateMailListCacheForTenant } from "./mail-list";
import { getProfile } from "./mail-list";
import {
  buildEncodedMimeMessage,
  buildReplyMimeMessage,
  buildForwardMimeMessage,
  extractEmail,
  type MimeAttachment,
} from "./mime";

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

export async function sendEmail(
  params: SendEmailParams,
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const profile = await getProfile();
  const from = profile?.emailAddress;

  let raw: string;

  if (params.inReplyTo) {
    raw = buildReplyMimeMessage({
      from,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      text: params.text,
      inReplyTo: params.inReplyTo,
      references: params.references || params.inReplyTo,
      attachments: params.attachments,
    });
  } else {
    raw = buildEncodedMimeMessage({
      from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments,
    });
  }

  const result = await ctx.client.gmail.api.messages.send({
    raw,
    threadId: params.threadId,
  });

  return {
    id: (result as { id?: string }).id || "",
    threadId: (result as { threadId?: string }).threadId || params.threadId || "",
  };
}

export async function replyToMessage(
  messageId: string,
  body: string,
  options: { replyAll?: boolean; html?: boolean } = {},
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const original = await ctx.client.gmail.api.messages.get({
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID", "References", "Date"],
  });

  const payload = (original as { payload?: { headers?: Array<{ name?: string; value?: string }> } }).payload;
  const headers = payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  const originalFrom = getHeader("From");
  const originalTo = getHeader("To");
  const originalCc = getHeader("Cc");
  const originalSubject = getHeader("Subject");
  const originalMessageId = getHeader("Message-ID");
  const originalReferences = getHeader("References");
  const threadId = (original as { threadId?: string }).threadId || "";

  const profile = await getProfile();
  const myEmail = profile?.emailAddress?.toLowerCase() || "";
  const replyTo: string[] = [];

  if (originalFrom) {
    const senderEmail = extractEmail(originalFrom).toLowerCase();
    if (senderEmail !== myEmail) {
      replyTo.push(originalFrom);
    }
  }

  if (options.replyAll) {
    if (originalTo) {
      for (const addr of originalTo.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail && email !== extractEmail(originalFrom).toLowerCase()) {
          replyTo.push(addr.trim());
        }
      }
    }
    if (originalCc) {
      const ccRecipients: string[] = [];
      for (const addr of originalCc.split(",")) {
        const email = extractEmail(addr).toLowerCase();
        if (email !== myEmail) {
          ccRecipients.push(addr.trim());
        }
      }
      if (ccRecipients.length > 0) {
        const subject = originalSubject.startsWith("Re:")
          ? originalSubject
          : `Re: ${originalSubject}`;

        const references = originalReferences
          ? `${originalReferences} ${originalMessageId}`
          : originalMessageId;

        return sendEmail({
          to: replyTo,
          cc: ccRecipients,
          subject,
          html: options.html !== false ? body : undefined,
          text: options.html === false ? body : undefined,
          threadId,
          inReplyTo: originalMessageId,
          references,
        });
      }
    }
  }

  if (replyTo.length === 0 && originalFrom) {
    replyTo.push(originalFrom);
  }

  const subject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const references = originalReferences
    ? `${originalReferences} ${originalMessageId}`
    : originalMessageId;

  return sendEmail({
    to: replyTo,
    subject,
    html: options.html !== false ? body : undefined,
    text: options.html === false ? body : undefined,
    threadId,
    inReplyTo: originalMessageId,
    references,
  });
}

export async function forwardMessage(
  messageId: string,
  to: string[],
  body?: string,
): Promise<{ id: string; threadId: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const original = await ctx.client.gmail.api.messages.get({
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
  });

  const payload = (original as { payload?: { headers?: Array<{ name?: string; value?: string }> } }).payload;
  const headers = payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  const originalFrom = getHeader("From");
  const originalTo = getHeader("To");
  const originalSubject = getHeader("Subject");
  const originalDate = getHeader("Date");
  const threadId = (original as { threadId?: string }).threadId || "";

  const profile = await getProfile();
  const from = profile?.emailAddress;

  const subject = originalSubject.startsWith("Fwd:")
    ? originalSubject
    : `Fwd: ${originalSubject}`;

  const raw = buildForwardMimeMessage({
    from,
    to,
    subject,
    html: body,
    text: body,
    originalFrom,
    originalDate,
    originalSubject,
    originalTo,
    originalBody: "",
  });

  const result = await ctx.client.gmail.api.messages.send({
    raw,
    threadId,
  });

  return {
    id: (result as { id?: string }).id || "",
    threadId: (result as { threadId?: string }).threadId || threadId || "",
  };
}
