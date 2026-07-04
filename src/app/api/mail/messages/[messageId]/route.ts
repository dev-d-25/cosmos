import { NextResponse } from "next/server";
import { getMessageById } from "@/server/mail/mail-commands";
import { getSessionTenantId } from "@/server/auth";
import { MailMessageSchema, MailMessageQuerySchema } from "@/server/mail/schemas";
import { toMailMessage } from "@/server/mail/transformers";
import { z } from "zod";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

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

  const result = await getMessageById(messageId, { force: query.refresh === "true" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (!result.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const transformed = toMailMessage(result.data.message);
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
    source: result.data.source,
  });
}
