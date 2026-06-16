import { NextResponse } from "next/server";
import { getCalendarEvents, createCalendarEvent } from "@/server/calendar";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";
import {
  CalendarEventsQuerySchema,
  CalendarCreateEventSchema,
  CalendarEventListResponseSchema,
} from "@/server/calendar/schemas";

export async function GET(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");
    const calendarId = url.searchParams.get("calendarId") ?? undefined;
    const refresh = url.searchParams.get("refresh") ?? undefined;

    const query = CalendarEventsQuerySchema.parse({
      timeMin,
      timeMax,
      calendarId,
      refresh,
    });

    const data = await getCalendarEvents({
      timeMin: query.timeMin,
      timeMax: query.timeMax,
      calendarId: query.calendarId,
      force: query.refresh === "true",
    });
    const validated = CalendarEventListResponseSchema.parse(data);
    return NextResponse.json(validated);
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "calendar_not_connected" },
        { status: 409 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[api/calendar/events] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const input = CalendarCreateEventSchema.parse(body);
    const event = await createCalendarEvent(input);
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "calendar_not_connected" },
        { status: 409 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[api/calendar/events] create error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
