"use server";

import { corsair } from "@/server/corsair";
import { getSessionTenantId, getAccountIdForTenant } from "@/server/connected-account";
import {
  type RawMessageEntity,
  upsertManyByEntityIds,
} from "@/server/db/mail-entities";
import { fetchMessageFull, fetchAttachment } from "./gmail-adapter";

export type AttachmentResult =
  | { ok: true; data: string; size: number }
  | { ok: false; status: number; error: string; body?: string };

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

async function fetchAndPersistFullBody(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  const raw = await fetchMessageFull(client, id);

  const payload = raw.payload as
    | { headers?: Array<{ name?: string; value?: string }> }
    | undefined;
  const headers = payload?.headers ?? [];
  const get = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;

  await upsertManyByEntityIds(accountId, [
    {
      entityId: id,
      data: {
        ...(raw as RawMessageEntity),
        id,
        subject: get("Subject"),
        from: get("From"),
        to: get("To"),
        createdAt: new Date(),
      },
    },
  ]);

  return raw;
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
