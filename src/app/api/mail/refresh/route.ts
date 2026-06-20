import { NextResponse } from "next/server";
import { refreshInbox } from "@/server/mail";
import { InboxRefreshResponseSchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const POST = withMailAuth(async (req: Request) => {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "INBOX";
  const data = await refreshInbox(view);
  const validated = InboxRefreshResponseSchema.parse(data);
  return NextResponse.json(validated);
});