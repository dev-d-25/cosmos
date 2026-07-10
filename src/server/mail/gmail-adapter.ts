"use server";

import { eq } from "drizzle-orm";

import { corsair } from "@/server/corsair";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";

type GmailFetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

/**
 * Raw fetch to Gmail API — used only for endpoints the SDK doesn't cover
 * (e.g. attachments). For messages.get / messages.list, use the SDK instead.
 */
async function gmailFetch<T>(
  client: ReturnType<typeof corsair.withTenant>,
  path: string,
  options?: { retries?: number },
): Promise<GmailFetchResult<T>> {
  const { retries = 3 } = options ?? {};

  const accessToken = await client.gmail.keys.get_access_token();
  if (!accessToken) return { ok: false, error: new Error("no_access_token") };

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

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

/**
 * Fetch message metadata via the Corsair SDK's `messages.get` with
 * `format=metadata`. The SDK handles auth, retries, and auto-upserts
 * the enriched record to the DB.
 *
 * Returns the SDK's Message object (with id, labelIds, snippet,
 * internalDate, payload.headers, etc.).
 */
export async function fetchMessageMetadata(
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
  metadataHeaders: string[] = ["Subject", "From", "To", "Date"],
): Promise<Array<{ id: string; raw: Record<string, unknown> }>> {
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const msg = await client.gmail.api.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders,
      });
      return { id, raw: msg as unknown as Record<string, unknown> };
    }),
  );

  const successes: Array<{ id: string; raw: Record<string, unknown> }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") successes.push(r.value);
  }
  return successes;
}

/**
 * Fetch full message body via the Corsair SDK's `messages.get` with
 * `format=full`. The SDK handles auth, retries, and auto-upserts
 * the complete record (including body) to the DB.
 */
export async function fetchMessageFull(
  client: ReturnType<typeof corsair.withTenant>,
  id: string,
): Promise<Record<string, unknown>> {
  const msg = await client.gmail.api.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  return msg as unknown as Record<string, unknown>;
}

/**
 * Fetch attachment data via raw HTTP — the SDK has no endpoint for this.
 */
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
}

export interface GmailListResult {
  messages: GmailListMessage[];
  nextPageToken?: string | null;
}

/**
 * Fetch message IDs (and nextPageToken) via the Corsair SDK's `messages.list`.
 * Returns only `{id, threadId}` per message — to get Subject/From/To/Date,
 * call `fetchMessageMetadata` or `enrichStubs` with the returned IDs.
 *
 * The SDK handles auth, retries, and the labelIds array is passed correctly
 * (the SDK's request builder flattens arrays into repeated query params).
 */
export async function listMessages(
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  maxResults: number,
  token?: string | null,
): Promise<GmailListResult> {
  const result = await client.gmail.api.messages.list({
    userId: "me",
    maxResults: Math.min(Math.max(1, maxResults), 500),
    ...(token ? { pageToken: token } : {}),
    ...(view.labelIds?.length ? { labelIds: view.labelIds } : {}),
    ...(view.query ? { q: view.query, includeSpamTrash: true } : {}),
  });

  return {
    messages: (result.messages ?? []) as GmailListMessage[],
    nextPageToken: result.nextPageToken ?? null,
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
