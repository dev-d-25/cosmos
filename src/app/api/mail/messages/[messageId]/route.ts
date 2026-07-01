import { NextResponse } from "next/server";
import { getMessageById } from "@/server/mail/mail-commands";
import { z } from "zod";
import { MailMessageSchema, MailMessageQuerySchema } from "@/server/mail/schemas";
import { toMailMessage } from "@/server/mail/transformers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
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
    const result = await getMessageById(messageId, { force: query.refresh === "true" });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    
    // Type guard to ensure result.data is not null
    if (result.data === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    
    const transformed = toMailMessage(result.data.message as Record<string, unknown>);
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
  } catch (err) {
    // This shouldn't happen since getMessageById catches all errors and returns them in CommandResult
    // But keeping it for safety
    console.error("[mail] getMessageById failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}