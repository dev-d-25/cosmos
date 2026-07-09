import { NextResponse } from "next/server";
import { z } from "zod";
import { refreshInbox } from "@/server/mail";
import { InboxRefreshResponseSchema, MAX_PAGE } from "@/server/mail/schemas";
import { withMailAuth } from "@/lib/mail/with-mail-auth";

const RefreshQuerySchema = z.object({
  view: z.string().min(1).default("INBOX"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
});

export const POST = withMailAuth(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = RefreshQuerySchema.safeParse({
    view: url.searchParams.get("view") ?? "INBOX",
    page: url.searchParams.get("page") ?? "1",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { view, page } = parsed.data;
  const data = await refreshInbox(view, page);
  const validated = InboxRefreshResponseSchema.parse(data);
  return NextResponse.json(validated);
});