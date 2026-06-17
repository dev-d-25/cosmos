import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionTenantId } from "@/server/auth";
import { createThread, listThreadsForUser } from "@/server/chat";
import { createThreadSchema } from "@/server/chat/schemas";
import { DEFAULT_MODEL } from "@/lib/ai/kilo";

export async function GET() {
  const userId = await getSessionTenantId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threads = await listThreadsForUser(userId);
  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const userId = await getSessionTenantId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createThreadSchema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    model: (body as { model?: string } | null)?.model ?? DEFAULT_MODEL,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const thread = await createThread(userId, parsed.data);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
