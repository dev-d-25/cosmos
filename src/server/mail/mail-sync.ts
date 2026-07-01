"use server";

import { getSessionTenantId, getAccountIdForTenant } from "@/server/connected-account";
import { corsair } from "@/server/corsair";
import { invalidateMailListCacheForTenant } from "./mail-list";

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

export async function clearMailCache(): Promise<{
  deletedMessages: number;
  deletedLabels: number;
}> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");
  invalidateMailListCacheForTenant(ctx.tenantId);

  const allMessages = await ctx.client.gmail.db.messages.list({ limit: 10000 });
  let deletedMessages = 0;
  for (const row of allMessages) {
    const entityId = row.data.id;
    if (typeof entityId === "string") {
      const ok = await ctx.client.gmail.db.messages.deleteByEntityId(entityId);
      if (ok) deletedMessages++;
    }
  }

  const allLabels = await ctx.client.gmail.db.labels.list();
  let deletedLabels = 0;
  for (const row of allLabels) {
    const entityId = row.data.id;
    if (typeof entityId === "string") {
      const ok = await ctx.client.gmail.db.labels.deleteByEntityId(entityId);
      if (ok) deletedLabels++;
    }
  }

  return { deletedMessages, deletedLabels };
}
