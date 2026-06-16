import { NextResponse } from "next/server";
import { AuthMissingError } from "corsair/core";
import { createDraft, updateDraft, deleteDraft } from "@/server/mail";

export async function POST(request: Request) {
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

    const params = { to, cc, bcc, subject, html };

    switch (action) {
      case "create": {
        const result = await createDraft(params);
        return NextResponse.json(result);
      }
      case "update": {
        if (!draftId) {
          return NextResponse.json({ error: "draftId required" }, { status: 400 });
        }
        const result = await updateDraft(draftId, params);
        return NextResponse.json(result);
      }
      case "delete": {
        if (!draftId) {
          return NextResponse.json({ error: "draftId required" }, { status: 400 });
        }
        const result = await deleteDraft(draftId);
        return NextResponse.json(result);
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
