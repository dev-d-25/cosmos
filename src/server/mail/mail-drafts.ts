"use server";

import { getClient } from "./mail-list";
import { buildEncodedMimeMessage } from "./mime";

export async function createDraft(params: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
}): Promise<{ id: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const { getProfile } = await import("./mail-profile");
  const profile = await getProfile();
  const from = profile?.emailAddress;
  const raw = buildEncodedMimeMessage({
    from,
    to: params.to ? params.to.split(",").map((e) => e.trim()).filter(Boolean) : [],
    cc: params.cc ? params.cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    bcc: params.bcc ? params.bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    subject: params.subject || "(No subject)",
    html: params.html || "",
  });
  const result = await ctx.client.gmail.api.drafts.create({
    draft: { message: { raw } },
  });
  return { id: (result as { id?: string }).id || "" };
}

export async function updateDraft(
  draftId: string,
  params: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    html?: string;
  },
): Promise<{ id: string }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  const { getProfile } = await import("./mail-profile");
  const profile = await getProfile();
  const from = profile?.emailAddress;
  const raw = buildEncodedMimeMessage({
    from,
    to: params.to ? params.to.split(",").map((e) => e.trim()).filter(Boolean) : [],
    cc: params.cc ? params.cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    bcc: params.bcc ? params.bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
    subject: params.subject || "(No subject)",
    html: params.html || "",
  });
  const result = await ctx.client.gmail.api.drafts.update({
    id: draftId,
    draft: { message: { raw } },
  });
  return { id: draftId, ...(result as object) };
}

export async function deleteDraft(draftId: string): Promise<{ ok: boolean }> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  await ctx.client.gmail.api.drafts.delete({ id: draftId });
  return { ok: true };
}
