"use server";

import { corsair } from "@/server/corsair";
import { getClient } from "./mail-list";
import { fetchMessageFull, fetchAttachment } from "./gmail-adapter";

/**
 * Fetch full message body via the SDK. The SDK's `messages.get` auto-upserts
 * the enriched record (subject, from, to, body) to the DB, so no manual
 * upsert is needed here.
 */
async function fetchAndPersistFullBody(
  _accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  return fetchMessageFull(client, id);
}

export async function getMessage(
  id: string,
  opts: { force?: boolean } = {},
): Promise<{
  message: Record<string, unknown>;
  source: "cache" | "live";
} | null> {
  const ctx = await getClient();
  if (!ctx) return null;
  const { accountId, client } = ctx;

  if (!opts.force) {
    const cached = await client.gmail.db.messages.findByEntityId(id);
    if (cached?.data?.payload) {
      const hasBody = cached.data.body
        || cached.data.payload.body?.data
        || cached.data.payload.parts?.some(
            (p: { body?: { data?: string } }) => !!p.body?.data,
          );
      if (hasBody) {
        return {
          message: cached.data as Record<string, unknown>,
          source: "cache",
        };
      }
    }
  }

  const full = await fetchAndPersistFullBody(accountId, client, id);

  return { message: full, source: "live" };
}

export async function prefetchFullBody(
  id: string,
): Promise<{ id: string; ok: boolean; error?: string }> {
  const ctx = await getClient();
  if (!ctx) return { id, ok: false, error: "unauthenticated" };
  try {
    await fetchAndPersistFullBody(ctx.accountId, ctx.client, id);
    return { id, ok: true };
  } catch (err) {
    return {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type AttachmentResult =
  | { ok: true; data: string; size: number }
  | { ok: false; status: number; error: string; body?: string };

export async function getAttachmentContent(
  messageId: string,
  attachmentId: string,
): Promise<AttachmentResult> {
  const ctx = await getClient();
  if (!ctx) {
    return { ok: false, status: 401, error: "no_corsair_client" };
  }
  const { client } = ctx;

  try {
    const result = await fetchAttachment(client, messageId, attachmentId);
    return { ok: true, data: result.data, size: result.size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusPart = message.includes("gmail_") ? message.split("_")[1] : undefined;
    const status = statusPart ? parseInt(statusPart) || 500 : 500;
    return {
      ok: false,
      status,
      error: message,
    };
  }
}
