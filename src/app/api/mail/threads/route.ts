import { NextResponse } from "next/server";
import { getMailList } from "@/server/mail";
import {
  MailThreadsQuerySchema,
  MailListResponseSchema,
} from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const GET = withMailAuth(async (request) => {
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
});
