import { eq } from "drizzle-orm";

import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";

import { db, conn } from "./db";
import { corsairAccounts, corsairIntegrations } from "./db/schema";

export const corsair = createCorsair({
  plugins: [gmail(), googlecalendar()],
  database: conn,
  kek: process.env.CORSAIR_KEK!,
  multiTenancy: true,
});

export async function getConnectedCorsairPlugins(tenantId: string) {
  const rows = await db
    .select({
      name: corsairIntegrations.name,
    })
    .from(corsairIntegrations)
    .innerJoin(corsairAccounts, eq(corsairIntegrations.id, corsairAccounts.integrationId))
    .where(
      eq(corsairAccounts.tenantId, tenantId),
    )
    .limit(10);

  return rows.map((row) => row.name);
}

export function hasConnectedCorsairPlugin(
  plugins: string[],
  plugin: "gmail" | "googlecalendar",
) {
  return plugins.includes(plugin);
}
