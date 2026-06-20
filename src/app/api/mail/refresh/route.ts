import { NextResponse } from "next/server";
import { refreshInbox } from "@/server/mail";
import { InboxRefreshResponseSchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const POST = withMailAuth(async (req: Request) => {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "INBOX";
  const rawPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const data = await refreshInbox(view, page);
  const validated = InboxRefreshResponseSchema.parse(data);
  return NextResponse.json(validated);
});