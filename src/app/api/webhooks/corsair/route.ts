import { processWebhook } from "corsair";
import { corsair } from "@/server/corsair";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const result = await processWebhook(corsair, headers, body, {
    tenantId: "default",
  });
  return NextResponse.json(result);
}
