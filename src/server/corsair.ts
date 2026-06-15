import { eq } from "drizzle-orm";

import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";

import { db, conn } from "./db";
import { corsairAccounts, corsairIntegrations } from "./db/schema";

export const corsair = createCorsair({
  plugins: [
    gmail({
      webhookHooks: {
        messageChanged: {
          before(ctx, args) {
            const body = args.payload as {
              message?: { data?: string };
            };
            const data = body?.message?.data;
            const decoded = data
              ? (JSON.parse(
                  Buffer.from(data, "base64").toString("utf-8"),
                ) as { emailAddress?: string; historyId?: string })
              : null;
            console.info("[gmail:webhook] messageChanged", {
              email: decoded?.emailAddress,
              historyId: decoded?.historyId,
            });
            return { ctx, args };
          },
          after(ctx, response) {
            console.info("[gmail:webhook] messageChanged processed", {
              type: response?.data?.type,
              email: response?.data?.emailAddress,
            });
          },
        },
      },
    }),
    googlecalendar(),
  ],
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
