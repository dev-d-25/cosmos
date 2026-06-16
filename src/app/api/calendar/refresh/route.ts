import { NextResponse } from "next/server";
import { refreshCalendarEvents } from "@/server/calendar";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";

export async function POST(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const timeMin = (body as { timeMin?: string }).timeMin;
    const timeMax = (body as { timeMax?: string }).timeMax;

    if (!timeMin || !timeMax) {
      return NextResponse.json(
        { error: "timeMin and timeMax are required" },
        { status: 400 },
      );
    }

    const result = await refreshCalendarEvents({ timeMin, timeMax });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "calendar_not_connected" },
        { status: 409 },
      );
    }
    console.error("[api/calendar/refresh] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
