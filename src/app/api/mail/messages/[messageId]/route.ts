import { NextResponse } from "next/server";
import { getMessage } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import { MailMessageSchema, MailMessageQuerySchema } from "@/server/mail/schemas";
import { toMailMessage } from "@/server/mail/transformers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  // Parse the query separately so only query errors return 400.
  // Any other ZodError (from SDK internals, etc.) is a 500.
  const rawRefresh = new URL(_req.url).searchParams.get("refresh") ?? undefined;
  let query: { refresh?: string };
  try {
    query = MailMessageQuerySchema.parse({ refresh: rawRefresh });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query", details: err.issues },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await getMessage(messageId, { force: query.refresh === "true" });
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const transformed = toMailMessage(result.message);
    const parsed = MailMessageSchema.safeParse(transformed);
    if (!parsed.success) {
      console.error("[mail] Invalid message data shape:", parsed.error.issues);
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
    console.error("[mail] getMessage failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
