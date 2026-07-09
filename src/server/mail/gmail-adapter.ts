"use server";

import { eq } from "drizzle-orm";

import { corsair } from "@/server/corsair";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";

async function getAccessToken(
  client: ReturnType<typeof corsair.withTenant>,
): Promise<string | null> {
  return client.gmail.keys.get_access_token();
}

async function refreshAuth(
  client: ReturnType<typeof corsair.withTenant>,
): Promise<string> {
  const gmail = client.gmail as unknown as {
    _refreshAuth?: () => Promise<string>;
  };
  if (!gmail._refreshAuth) throw new Error("no_refresh_auth");
  return gmail._refreshAuth();
}

type GmailFetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

async function gmailFetch<T>(
  client: ReturnType<typeof corsair.withTenant>,
  path: string,
  options?: { retries?: number },
): Promise<GmailFetchResult<T>> {
  const { retries = 3 } = options ?? {};

  let accessToken = await getAccessToken(client);
  if (!accessToken) return { ok: false, error: new Error("no_access_token") };

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`;

  const doFetch = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response = await doFetch(accessToken);

    if (response.status === 401 && attempt === 0) {
      try {
        accessToken = await refreshAuth(client);
        response = await doFetch(accessToken);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }
    }

    if (response.status === 429 && attempt < retries) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
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

    const value = (await response.json()) as T;
    return { ok: true, value };
  }

  return { ok: false, error: lastError ?? new Error("exhausted_retries") };
}

export async function fetchMessageMetadata(
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
  metadataHeaders: string[] = ["Subject", "From", "To", "Date"],
): Promise<Array<{ id: string; raw: Record<string, unknown> }>> {
  const headersParam = metadataHeaders
    .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
    .join("&");

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const result = await gmailFetch<Record<string, unknown>>(
        client,
        `messages/${id}?format=metadata&${headersParam}`,
      );
      if (!result.ok) throw result.error;
      return { id, raw: result.value };
    }),
  );

  const successes: Array<{ id: string; raw: Record<string, unknown> }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") successes.push(r.value);
  }
  return successes;
}

export async function fetchMessageFull(
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  const result = await gmailFetch<Record<string, unknown>>(
    client,
    `messages/${id}?format=full`,
  );
  if (!result.ok) throw result.error;
  return result.value;
}

export async function fetchAttachment(
  client: ReturnType<typeof corsair.withTenant>,
  messageId: string,
  attachmentId: string,
): Promise<{ data: string; size: number }> {
  const result = await gmailFetch<{ data: string; size: number }>(
    client,
    `messages/${messageId}/attachments/${attachmentId}`,
  );
  if (!result.ok) throw result.error;
  return result.value;
}

export interface GmailListMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name?: string; value?: string }> };
}

export interface GmailListResult {
  messages: GmailListMessage[];
  nextPageToken?: string | null;
}

/**
 * Single `messages.list(format=metadata, maxResults, token?)` call that returns
 * id + Subject/From/To/Date for up to 500 messages at once. Replaces the old
 * per-message `messages.get` storm that `enrichStubs` did. Returns the raw
 * `nextPageToken` so callers can persist it and walk the mailbox on demand.
 *
 * Uses the shared `gmailFetch` (401-refresh + 429-retry), so it is serverless
 * safe and never blocks on a background queue.
 */
export async function listMessages(
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  maxResults: number,
  token?: string | null,
): Promise<GmailListResult> {
  const params = new URLSearchParams();
  params.set("maxResults", String(Math.min(Math.max(1, maxResults), 500)));
  if (token) params.set("pageToken", token);
  if (view.labelIds?.length) {
    for (const id of view.labelIds) params.append("labelIds", id);
  }
  if (view.query) {
    params.set("q", view.query);
    params.set("includeSpamTrash", "true");
  }
  params.set("format", "metadata");
  for (const h of ["Subject", "From", "To", "Date"]) {
    params.append("metadataHeaders", h);
  }

  const result = await gmailFetch<GmailListResult>(
    client,
    `messages?${params.toString()}`,
  );
  if (!result.ok) throw result.error;

  return {
    messages: result.value.messages ?? [],
    nextPageToken: result.value.nextPageToken ?? null,
  };
}

export async function resolveWebhookTenant(
  body: string | Record<string, unknown>,
  fallbackTenant: string,
): Promise<string> {
  if (typeof body !== "object" || body === null) return fallbackTenant;
  const message = (body as { message?: { data?: string } }).message;
  if (!message?.data) return fallbackTenant;
  try {
    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString("utf-8"),
    ) as { emailAddress?: string };
    const email = decoded.emailAddress;
    if (!email) return fallbackTenant;
    const row = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    return row[0]?.id ?? fallbackTenant;
  } catch {
    return fallbackTenant;
  }
}
