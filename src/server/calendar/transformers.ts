import type { CalendarEvent } from "./types";

interface CorsairEntityRow {
  entity_id: string;
  data: Record<string, unknown>;
  updated_at: Date;
}

function isAllDayEvent(event: Record<string, unknown>): boolean {
  const start = event.start as { date?: string; dateTime?: string } | undefined;
  return Boolean(start?.date && !start?.dateTime);
}

export function toCalendarEvent(row: CorsairEntityRow): CalendarEvent {
  const d = row.data;
  const id = row.entity_id;

  const start = d.start as { date?: string; dateTime?: string; timeZone?: string } | undefined;
  const end = d.end as { date?: string; dateTime?: string; timeZone?: string } | undefined;

  const attendees = (d.attendees as Array<{
    email?: string;
    displayName?: string;
    responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
    self?: boolean;
  }>) ?? [];

  return {
    id,
    summary: (d.summary as string) ?? "",
    description: (d.description as string) ?? "",
    location: (d.location as string) ?? "",
    status: (d.status as "confirmed" | "tentative" | "cancelled") ?? "confirmed",
    start: start ? { date: start.date, dateTime: start.dateTime, timeZone: start.timeZone } : undefined,
    end: end ? { date: end.date, dateTime: end.dateTime, timeZone: end.timeZone } : undefined,
    isAllDay: isAllDayEvent(d as Record<string, unknown>),
    attendees: attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
    })),
    htmlLink: (d.htmlLink as string) ?? "",
    calendarId: (d.calendarId as string) ?? "primary",
    colorId: d.colorId as string | undefined,
    recurrence: d.recurrence as string[] | undefined,
    recurringEventId: d.recurringEventId as string | undefined,
    visibility: d.visibility as "default" | "public" | "private" | "confidential" | undefined,
    transparency: d.transparency as "opaque" | "transparent" | undefined,
    createdAt: (d.created as string) ?? undefined,
    updatedAt: (d.updated as string) ?? undefined,
  };
}

export function dedupeByEntityId(rows: CorsairEntityRow[]): CorsairEntityRow[] {
  const byId = new Map<string, CorsairEntityRow>();
  for (const row of rows) {
    const existing = byId.get(row.entity_id);
    if (!existing || row.updated_at > existing.updated_at) {
      byId.set(row.entity_id, row);
    }
  }
  return Array.from(byId.values());
}

export function sortEventsByStart(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const aStart = a.start?.dateTime ?? a.start?.date ?? "";
    const bStart = b.start?.dateTime ?? b.start?.date ?? "";
    return aStart.localeCompare(bStart);
  });
}
