"use server";

import { corsair } from "@/server/corsair";
import {
  upsertManyByEntityIds,
  type RawMessageEntity,
} from "@/server/db/mail-entities";
import { getClient } from "./mail-list";

async function fetchGmailMessageWithRefresh(
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: Error }
> {
  let accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    return { ok: false, error: new Error("no_access_token") };
  }

  const doFetch = async (token: string): Promise<Response> => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  };

  let response = await doFetch(accessToken);
  if (response.status === 401) {
    const gmail = client.gmail as unknown as {
      _refreshAuth?: () => Promise<string>;
    };
    if (gmail._refreshAuth) {
      try {
        accessToken = await gmail._refreshAuth();
        response = await doFetch(accessToken);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: new Error(
        `gmail_${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      ),
    };
  }

  const value = (await response.json()) as Record<string, unknown>;
  return { ok: true, value };
}

async function fetchAndPersistFullBody(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  const tokenResult = await fetchGmailMessageWithRefresh(client, id);
  if (!tokenResult.ok) {
    throw tokenResult.error;
  }
  const raw = tokenResult.value;

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

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;

  const fetchOnce = async (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) {
    return { ok: false, status: 401, error: "no_access_token" };
  }

  let response = await fetchOnce(accessToken);

  if (response.status === 401) {
    const gmail = client.gmail as unknown as {
      _refreshAuth?: () => Promise<string>;
    };
    if (gmail._refreshAuth) {
      try {
        accessToken = await gmail._refreshAuth();
        response = await fetchOnce(accessToken);
      } catch {
        // fall through with the original 401
      }
    }
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {}
    console.warn(
      `[mail] attachment fetch failed: messageId=${messageId} attachmentId=${attachmentId} status=${response.status} body=${body.slice(0, 200)}`,
    );
    return {
      ok: false,
      status: response.status,
      body: body.slice(0, 500),
      error: `gmail_${response.status}`,
    };
  }

  const result = (await response.json()) as { data: string; size: number };
  return { ok: true, data: result.data, size: result.size };
}
