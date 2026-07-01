"use server";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { generateOAuthUrl, processOAuthCallback } from "corsair/oauth";

import { auth } from "@/server/better-auth";
import { corsair } from "@/server/corsair";
import { db } from "@/server/db";
import { corsairAccounts, corsairIntegrations } from "@/server/db/schema";

const REDIRECT_URI = `${process.env.APP_URL}/api/auth/corsair`;

// ─── Session resolution ──────────────────────────────────────────────

/**
 * Cached per-request session lookup.
 * React's cache() deduplicates calls within a single server render / action.
 */
export const getSessionTenantId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session?.user?.id ?? null;
});

// ─── Account resolution ──────────────────────────────────────────────

/**
 * Resolve the account_id for a given tenant.
 * Mirrors corsair's internal mapping (tenant → integration account).
 */
export async function getAccountIdForTenant(
  tenantId: string,
): Promise<string | null> {
  const rows = await db
    .select({ accountId: corsairAccounts.id })
    .from(corsairAccounts)
    .innerJoin(
      corsairIntegrations,
      eq(corsairIntegrations.id, corsairAccounts.integrationId),
    )
    .where(
      eq(corsairAccounts.tenantId, tenantId),
    )
    .limit(1);
  return rows[0]?.accountId ?? null;
}

/**
 * Combined session + account resolution.
 * Returns { tenantId, accountId, client } or null if not authenticated.
 */
export async function getClientContext() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

// ─── Plugin status ───────────────────────────────────────────────────

/**
 * List connected integration names for a tenant.
 */
export async function getConnectedPlugins(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ name: corsairIntegrations.name })
    .from(corsairIntegrations)
    .innerJoin(corsairAccounts, eq(corsairIntegrations.id, corsairAccounts.integrationId))
    .where(eq(corsairAccounts.tenantId, tenantId))
    .limit(10);

  return rows.map((row) => row.name);
}

/**
 * Check if a specific plugin is connected for a tenant.
 */
export async function isPluginConnected(
  tenantId: string,
  plugin: "gmail" | "googlecalendar",
): Promise<boolean> {
  const plugins = await getConnectedPlugins(tenantId);
  return plugins.includes(plugin);
}

// ─── OAuth flow ──────────────────────────────────────────────────────

/**
 * Generate the OAuth URL and state for a connect initiation.
 */
export async function initiateOAuth(
  tenantId: string,
  plugin: string,
): Promise<{ url: string; state: string }> {
  return generateOAuthUrl(corsair, plugin, {
    tenantId,
    redirectUri: REDIRECT_URI,
  });
}

/**
 * Complete the OAuth callback.
 * Validates state, processes the callback, returns the plugin name.
 */
export async function completeOAuth(
  code: string,
  state: string,
): Promise<{ plugin: string }> {
  const result = await processOAuthCallback(corsair, {
    code,
    state,
    redirectUri: REDIRECT_URI,
  });
  return { plugin: result.plugin };
}
