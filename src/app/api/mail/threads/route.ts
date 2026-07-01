import { NextResponse } from "next/server";
import { withMailAuth } from "@/lib/mail/with-mail-auth";
import { getThreadList } from "@/server/mail/mail-commands";

export const GET = withMailAuth(async (request) => {
  const url = new URL(request.url);
  const rawPage = url.searchParams.get("page") ?? undefined;
  const rawLabelIds = url.searchParams.get("labelIds") ?? undefined;
  const labelIds = rawLabelIds ? rawLabelIds.split(",").filter(Boolean) : undefined;
  const rawQ = url.searchParams.get("q") ?? undefined;

  // page is 1-based in the URL. parseInt with a fallback to 1 if absent
  // or non-numeric. The server clamps to [1, totalPages].
  const parsedPage = rawPage ? Number(rawPage) : 1;
  const page = Number.isFinite(parsedPage) && parsedPage >= 1
    ? Math.floor(parsedPage)
    : 1;

  const result = await getThreadList({
    page,
    labelIds,
    q: rawQ,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
});