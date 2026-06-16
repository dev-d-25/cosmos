import { NextResponse } from "next/server";
import { getProfile } from "@/server/mail";
import { MailProfileSchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const GET = withMailAuth(async () => {
  const data = await getProfile();
  if (!data) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const validated = MailProfileSchema.parse(data);
  return NextResponse.json(validated);
});
