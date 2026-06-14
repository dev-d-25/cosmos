import { NextResponse } from "next/server";
import { getMessage } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import { MailMessageSchema, MailMessageQuerySchema } from "@/server/mail/schemas";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawRefresh = new URL(_req.url).searchParams.get("refresh");

    const query = MailMessageQuerySchema.parse({
      refresh: rawRefresh,
    });

    const result = await getMessage(params.id, { force: query.refresh === "true" });
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const validated = {
      message: MailMessageSchema.safeParse(result.message),
      source: result.source,
    };

    if (!validated.message.success) {
      return NextResponse.json(
        { error: "Invalid message data" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: validated.message.data,
      source: validated.source,
    });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    throw err;
  }
}
