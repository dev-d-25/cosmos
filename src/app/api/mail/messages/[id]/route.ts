import { NextResponse } from "next/server";
import { getMessage } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import { MailMessageSchema, MailMessageQuerySchema } from "@/server/mail/schemas";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const rawRefresh = new URL(_req.url).searchParams.get("refresh");

    const query = MailMessageQuerySchema.parse({
      refresh: rawRefresh,
    });

    const result = await getMessage(id, { force: query.refresh === "true" });
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = MailMessageSchema.safeParse(result.message);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid message data" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: parsed.data,
      source: result.source,
    });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
