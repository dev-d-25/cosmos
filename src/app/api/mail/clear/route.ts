import { NextResponse } from "next/server";
import { corsair } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";

export async function POST() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = corsair.withTenant(tenantId);

    // List all cached message entity IDs and delete them
    const allMessages = await client.gmail.db.messages.list({ limit: 10000 });
    let deletedMessages = 0;
    for (const row of allMessages) {
      const entityId = row.data.id;
      if (typeof entityId === "string") {
        const ok = await client.gmail.db.messages.deleteByEntityId(entityId);
        if (ok) deletedMessages++;
      }
    }

    // List all cached label entity IDs and delete them
    const allLabels = await client.gmail.db.labels.list();
    let deletedLabels = 0;
    for (const row of allLabels) {
      const entityId = row.data.id;
      if (typeof entityId === "string") {
        const ok = await client.gmail.db.labels.deleteByEntityId(entityId);
        if (ok) deletedLabels++;
      }
    }

    return NextResponse.json({ deletedMessages, deletedLabels });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
