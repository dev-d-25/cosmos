import { NextResponse } from "next/server";
import { getCalendarEvents } from "@/server/calendar";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Fetch a single event by ID using the events list with a time range,
    // then filter by ID. The corsair plugin doesn't have a single-event get endpoint.
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAhead = new Date(now);
    threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);

    const result = await getCalendarEvents({
      timeMin: threeMonthsAgo.toISOString(),
      timeMax: threeMonthsAhead.toISOString(),
      force: false,
    });

    const event = result.items.find((e) => e.id === id);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json(event);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "calendar_not_connected" },
        { status: 409 },
      );
    }
    console.error("[api/calendar/events/[id]] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
