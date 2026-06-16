import { NextResponse } from "next/server";
import { refreshInbox } from "@/server/mail";
import { InboxRefreshResponseSchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const POST = withMailAuth(async () => {
  const data = await refreshInbox();
  const validated = InboxRefreshResponseSchema.parse(data);
  return NextResponse.json(validated);
});
