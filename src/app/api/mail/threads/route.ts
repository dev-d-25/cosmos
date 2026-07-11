import { NextResponse } from "next/server";
import { getThreadList } from "@/server/mail/mail-commands";
import { MailThreadsQuerySchema } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

export const GET = withMailAuth(async (request) => {
  const url = new URL(request.url);
  const parsed = MailThreadsQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    token: url.searchParams.get("token") ?? undefined,
    labelIds: url.searchParams.get("labelIds")
      ? url.searchParams.get("labelIds")!.split(",").filter(Boolean)
      : undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await getThreadList(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
});
