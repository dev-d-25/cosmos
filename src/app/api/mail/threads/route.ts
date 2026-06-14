import { NextResponse } from "next/server";
import { getMailList } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import { MailThreadsQuerySchema, MailListResponseSchema } from "@/server/mail/schemas";

export async function GET(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const rawRefresh = url.searchParams.get("refresh");

    const query = MailThreadsQuerySchema.parse({
      limit: rawLimit,
      refresh: rawRefresh,
    });

    const data = await getMailList({ limit: query.limit, force: query.refresh === "true" });
    const validated = MailListResponseSchema.parse(data);
    return NextResponse.json(validated);
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
