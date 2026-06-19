import { NextResponse } from "next/server";
import { prefetchFullBody } from "@/server/mail";
import { getSessionTenantId } from "@/server/auth";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  if (!messageId || typeof messageId !== "string") {
    return NextResponse.json({ error: "Invalid messageId" }, { status: 400 });
  }

  const result = await prefetchFullBody(messageId);
  if (!result.ok) {
    return NextResponse.json(
      { id: result.id, ok: false, error: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json(result);
}
