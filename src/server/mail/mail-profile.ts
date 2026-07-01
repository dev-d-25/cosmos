"use server";

import { corsair } from "@/server/corsair";
import { getClient } from "./mail-list";
import {
  GetProfileApiResponseSchema,
  MailLabelSchema,
} from "./schemas";
import type {
  MailLabel,
  MailProfile,
} from "./schemas";
import { MAIL_LABELS } from "@/lib/mail/labels";

const LABEL_COUNT_TTL_MS = 5 * 60 * 1000;

async function refreshLabelCount(
  client: ReturnType<typeof corsair.withTenant>,
  labelId: string,
): Promise<boolean> {
  try {
    const label = (await client.gmail.api.labels.get({ id: labelId })) as
      | Record<string, unknown>
      | null;
    const labelIdFromResult = label?.id;
    if (typeof labelIdFromResult !== "string") return false;
    await client.gmail.db.labels.upsertByEntityId(labelIdFromResult, {
      ...label,
      id: labelIdFromResult,
      createdAt: new Date(),
    });
    return true;
  } catch (err) {
    const describeError = (e: unknown): string => {
      if (e && typeof e === "object") {
        const obj = e as { status?: number; code?: number | string; message?: string };
        if (obj.status) return `HTTP ${obj.status}`;
        if (obj.code != null) return `code ${obj.code}`;
        if (obj.message) return obj.message.slice(0, 200);
      }
      return String(e).slice(0, 200);
    };
    console.log(
      `[mail-debug] getLabels: labels.get(${labelId}) failed: ${describeError(err)}`,
    );
    return false;
  }
}

export async function getLabels(): Promise<MailLabel[]> {
  const ctx = await getClient();
  if (!ctx) return [];
  const { client } = ctx;

  let cached = await client.gmail.db.labels.list();

  const now = Date.now();
  const systemLabelIds = MAIL_LABELS.flatMap((def) =>
    def.gmailLabel ? [def.gmailLabel] : [],
  );
  const idsNeedingRefresh = new Set<string>();

  for (const id of systemLabelIds) {
    const row = cached.find(
      (r) => (r.data as Record<string, unknown>)?.id === id,
    );
    if (!row) {
      idsNeedingRefresh.add(id);
      continue;
    }
    const total = (row.data as Record<string, unknown>)?.messagesTotal;
    const rawUpdated = (row as { updated_at?: Date | string }).updated_at;
    const updated =
      rawUpdated instanceof Date
        ? rawUpdated.getTime()
        : typeof rawUpdated === "string"
          ? Date.parse(rawUpdated)
          : null;
    if (typeof total !== "number" || updated === null || now - updated > LABEL_COUNT_TTL_MS) {
      idsNeedingRefresh.add(id);
    }
  }

  if (idsNeedingRefresh.size > 0) {
    const results = await Promise.allSettled(
      Array.from(idsNeedingRefresh).map((id) => refreshLabelCount(client, id)),
    );
    const refreshed = results.filter((r) => r.status === "fulfilled" && r.value).length;
    console.log(
      `[mail-debug] getLabels: refreshed ${refreshed}/${idsNeedingRefresh.size} labels via labels.get`,
    );
    cached = await client.gmail.db.labels.list();
  }

  if (cached.length > 0) {
    return cached
      .map((r) => MailLabelSchema.safeParse(r.data))
      .filter(
        (result): result is { success: true; data: MailLabel } =>
          result.success,
      )
      .map((result) => result.data);
  }

  const result = await client.gmail.api.labels.list({});
  const rawLabels = (result.labels ?? []) as Array<Record<string, unknown>>;

  return rawLabels
    .map((l) => MailLabelSchema.safeParse(l))
    .filter(
      (result): result is { success: true; data: MailLabel } =>
        result.success,
    )
    .map((result) => result.data);
}

const PROFILE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<string, { value: MailProfile; at: number }>();

export async function getProfile(): Promise<MailProfile | null> {
  const ctx = await getClient();
  if (!ctx) return null;
  const { tenantId, client } = ctx;

  const hit = profileCache.get(tenantId);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;

  const corsairApi = client.gmail.api as unknown as {
    usersGetProfile?: (opts: {}) => Promise<unknown>;
  };
  const raw = await corsairApi.usersGetProfile?.({});
  if (!raw) {
    return null;
  }

  const parsed = GetProfileApiResponseSchema.parse(raw);

  let name = "";
  let picture = "";
  try {
    const { getSession } = await import("@/server/better-auth/server");
    const session = await getSession();
    name = (session?.user as { name?: string })?.name ?? "";
    picture = (session?.user as { image?: string })?.image ?? "";
  } catch {
    // Fall back to email-derived name
  }

  const value: MailProfile = {
    emailAddress: parsed.emailAddress,
    messagesTotal: parsed.messagesTotal,
    threadsTotal: parsed.threadsTotal,
    historyId: parsed.historyId,
    cachedAt: new Date().toISOString(),
    name: name || parsed.emailAddress?.split("@")[0] || "",
    picture,
  };
  profileCache.set(tenantId, { value, at: Date.now() });
  return value;
}
