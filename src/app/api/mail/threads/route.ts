import { NextResponse } from "next/server";
import { getMailList } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import {
  MailThreadsQuerySchema,
  MailListResponseSchema,
} from "@/server/mail/schemas";

export async function GET(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const rawPage = url.searchParams.get("page") ?? undefined;
    const rawPageSize = url.searchParams.get("pageSize") ?? undefined;
    const rawToken = url.searchParams.get("token") ?? undefined;
    const rawRefresh = url.searchParams.get("refresh") ?? undefined;
    const rawLabelIds = url.searchParams.get("labelIds") ?? undefined;
    const labelIds = rawLabelIds ? rawLabelIds.split(",").filter(Boolean) : undefined;
    const rawQ = url.searchParams.get("q") ?? undefined;

    const query = MailThreadsQuerySchema.parse({
      page: rawPage,
      pageSize: rawPageSize,
      token: rawToken,
      refresh: rawRefresh,
    });

    const data = await getMailList({
      pageIndex: query.page,
      pageSize: query.pageSize,
      pageToken: query.token ?? null,
      force: query.refresh === "true",
      labelIds,
      q: rawQ,
    });
    const validated = MailListResponseSchema.parse(data);
    return NextResponse.json(validated);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "gmail_not_connected" },
        { status: 409 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[api/mail/threads] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
