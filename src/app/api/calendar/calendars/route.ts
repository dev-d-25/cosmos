import { NextResponse } from "next/server";
import { getCalendarList } from "@/server/calendar";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";

export async function GET() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendars = await getCalendarList();
    return NextResponse.json(calendars);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "calendar_not_connected" },
        { status: 409 },
      );
    }
    console.error("[api/calendar/calendars] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
