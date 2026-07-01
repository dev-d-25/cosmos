"use server";

import { corsair } from "@/server/corsair";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";
import { eq } from "drizzle-orm";

// ─── Token helpers ──────────────────────────────────────────────

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

// ─── Generic Gmail REST fetch ────────────────────────────────────

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

    // 401 → refresh token and retry once
    if (response.status === 401 && attempt === 0) {
      try {
        accessToken = await refreshAuth(client);
        response = await doFetch(accessToken);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }
    }

    // 429 → retry with backoff
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

// ─── Public exports ──────────────────────────────────────────────

/**
 * Fetch metadata headers for a batch of message IDs.
 * Used by enrichStubs to populate from/ subject/ to fields.
 */
export async function fetchMessageMetadata(
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
  metadataHeaders: string[] = ["Subject", "From", "To", "Date"],
): Promise<Array<{ id: string; raw: Record<string, unknown> }>> {
  const results: Array<{ id: string; raw: Record<string, unknown> }> = [];

  for (const id of ids) {
    const headersParam = metadataHeaders
      .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
      .join("&");
    const result = await gmailFetch<Record<string, unknown>>(
      client,
      `messages/${id}?format=metadata&${headersParam}`,
    );
    if (result.ok) {
      results.push({ id, raw: result.value });
    }
  }

  return results;
}

/**
 * Fetch a single message with full body content.
 * Returns the raw Gmail API response.
 */
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

/**
 * Fetch an attachment by messageId and attachmentId.
 * Returns base64-encoded data + size.
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

/**
 * Resolve the tenant ID from a Gmail Pub/Sub webhook payload.
 * Extracts the emailAddress from the base64-encoded message data,
 * looks up the user row in the DB, and returns the tenant ID.
 * Falls back to `fallbackTenant` if the email can't be resolved.
 */
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
