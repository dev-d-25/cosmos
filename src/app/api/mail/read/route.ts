import { NextResponse } from "next/server";
import { markAsRead } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";

const BodySchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export async function POST(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { ids } = BodySchema.parse(body);
    const result = await markAsRead(ids);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "gmail_not_connected" },
        { status: 409 },
      );
    }
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
