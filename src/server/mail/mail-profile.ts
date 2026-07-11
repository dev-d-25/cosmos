"use server";

import { corsair } from "@/server/corsair";
import { getClient } from "./mail-list";
import { describeError } from "./mail-utils";
import { MailLabelSchema } from "./schemas";
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
  const { tenantId } = ctx;

  const hit = profileCache.get(tenantId);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;

  let name = "";
  let email = "";
  let picture = "";
  try {
    const { getSession } = await import("@/server/better-auth/server");
    const session = await getSession();
    if (session?.user) {
      const u = session.user as Record<string, unknown>;
      name = (typeof u.name === "string" ? u.name : "") || "";
      email = (typeof u.email === "string" ? u.email : "") || "";
      picture = (typeof u.image === "string" ? u.image : "") || "";
    }
  } catch {
    // Fall back
  }

  const value: MailProfile = {
    emailAddress: email,
    messagesTotal: 0,
    threadsTotal: 0,
    historyId: "",
    cachedAt: new Date().toISOString(),
    name: name || email.split("@")[0] || "User",
    picture,
  };
  profileCache.set(tenantId, { value, at: Date.now() });
  return value;
}
