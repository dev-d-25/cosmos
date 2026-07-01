import { NextResponse } from "next/server";
import { dispatchSendAction } from "@/server/mail/mail-commands";

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body as { action: string };

  const result = await dispatchSendAction(action, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}