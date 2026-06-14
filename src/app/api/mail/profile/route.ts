import { NextResponse } from "next/server";
import { getProfile } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import { MailProfileSchema } from "@/server/mail/schemas";

export async function GET() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getProfile();
    if (!data) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const validated = MailProfileSchema.parse(data);
    return NextResponse.json(validated);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid response", details: err.issues }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
