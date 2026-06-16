import { NextResponse } from "next/server";
import { clearMailCache } from "@/server/mail";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const POST = withMailAuth(async () => {
  const result = await clearMailCache();
  return NextResponse.json(result);
});
