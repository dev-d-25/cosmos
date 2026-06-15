import { NextResponse } from "next/server";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { corsair } from "@/server/corsair";
import { buildEncodedMimeMessage } from "@/server/mail/mime";

export async function POST(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, draftId, to, cc, bcc, subject, html } = body as {
      action: "create" | "update" | "delete";
      draftId?: string;
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      html?: string;
    };

    const client = corsair.withTenant(tenantId);

    switch (action) {
      case "create":
      case "update": {
        const raw = buildEncodedMimeMessage({
          to: to ? to.split(",").map((e) => e.trim()).filter(Boolean) : [],
          cc: cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
          bcc: bcc ? bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
          subject: subject || "(No subject)",
          html: html || "",
        });

        if (action === "update" && draftId) {
          const result = await client.gmail.api.drafts.update({
            id: draftId,
            draft: { message: { raw } },
          });
          return NextResponse.json({ id: draftId, ...result });
        }

        const result = await client.gmail.api.drafts.create({
          draft: { message: { raw } },
        });
        return NextResponse.json({ id: (result as { id?: string }).id || "" });
      }
      case "delete": {
        if (!draftId) {
          return NextResponse.json({ error: "draftId required" }, { status: 400 });
        }
        await client.gmail.api.drafts.delete({ id: draftId });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
