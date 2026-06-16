import { NextResponse } from "next/server";
import { markAsRead } from "@/server/mail";
import { z } from "zod";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

const BodySchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export const POST = withMailAuth(async (request) => {
  const body = await request.json();
  const { ids } = BodySchema.parse(body);
  const result = await markAsRead(ids);
  return NextResponse.json(result);
});
