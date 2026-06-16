import { NextResponse } from "next/server";
import { getLabels } from "@/server/mail";
import { MailLabelsResponseSchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const GET = withMailAuth(async () => {
  const data = await getLabels();
  const validated = MailLabelsResponseSchema.parse(data);
  return NextResponse.json(validated);
});
