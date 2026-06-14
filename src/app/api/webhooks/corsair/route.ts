import { corsair, processWebhook } from "corsair";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const result = await processWebhook(corsair, headers, body, {
    tenantId: "default",
  });
  return NextResponse.json(
    result,
    { status: (result as { success: boolean }).success ? 200 : 400 },
  );
}
