"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
import { toCalendarEvent, dedupeByEntityId, sortEventsByStart } from "./transformers";
import {
  CalendarEventListResponseSchema,
  CalendarInfoSchema,
} from "./schemas";
import type {
  CalendarEvent,
  CalendarEventListResponse,
  CalendarInfo,
  CalendarPageData,
} from "./types";

async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  return { tenantId, client: corsair.withTenant(tenantId) };
}

export async function getCalendarPageData(opts: {
  force?: boolean;
  timeMin: string;
  timeMax: string;
}): Promise<CalendarPageData | null> {
  const ctx = await getClient();
  if (!ctx) return null;

  const plugins = await getConnectedCorsairPlugins(ctx.tenantId);
  const connected = plugins.includes("googlecalendar");

  if (!connected) {
    return { tenantId: ctx.tenantId, calendarConnected: false };
  }

  const [events, calendars] = await Promise.all([
    getCalendarEvents({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      force: opts.force,
    }),
    getCalendarList(),
  ]);

  return {
    tenantId: ctx.tenantId,
    calendarConnected: true,
    events,
    calendars,
  };
}

export async function getCalendarEvents(opts: {
  timeMin: string;
  timeMax: string;
  calendarId?: string;
  force?: boolean;
}): Promise<CalendarEventListResponse> {
  const ctx = await getClient();
  if (!ctx) {
    return { items: [], nextPageToken: null, source: "cache" };
  }

  const calendarId = opts.calendarId ?? "primary";

  // Try cache first (unless force refresh)
  if (!opts.force) {
    try {
      const cached = await ctx.client.googlecalendar.db.events.list({
        limit: 200,
        offset: 0,
      });

      const deduped = dedupeByEntityId(cached);
      const allEvents = deduped.map(toCalendarEvent);

      // Filter to requested time range
      const filtered = allEvents.filter((event) => {
        const eventStart = event.start?.dateTime ?? event.start?.date;
        const eventEnd = event.end?.dateTime ?? event.end?.date;
        if (!eventStart) return false;

        const eventStartMs = new Date(eventStart).getTime();
        const eventEndMs = eventEnd ? new Date(eventEnd).getTime() : eventStartMs;
        const rangeStartMs = new Date(opts.timeMin).getTime();
        const rangeEndMs = new Date(opts.timeMax).getTime();

        // Event overlaps with range if it starts before range ends and ends after range starts
        return eventStartMs < rangeEndMs && eventEndMs > rangeStartMs;
      });

      if (filtered.length > 0) {
        return {
          items: sortEventsByStart(filtered),
          nextPageToken: null,
          source: "cache",
        };
      }
    } catch {
      // Cache miss, fall through to API
    }
  }

  // Fetch from Google Calendar API
  const result = await ctx.client.googlecalendar.api.events.getMany({
    calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    maxResults: 250,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events: CalendarEvent[] = (result.items ?? []).map((item) => ({
    id: item.id ?? "",
    summary: item.summary ?? "",
    description: item.description ?? "",
    location: item.location ?? "",
    status: item.status ?? "confirmed",
    start: item.start ? { date: item.start.date, dateTime: item.start.dateTime, timeZone: item.start.timeZone } : undefined,
    end: item.end ? { date: item.end.date, dateTime: item.end.dateTime, timeZone: item.end.timeZone } : undefined,
    isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
    attendees: (item.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
    })),
    htmlLink: item.htmlLink ?? "",
    calendarId,
    colorId: item.colorId,
    recurrence: item.recurrence,
    recurringEventId: item.recurringEventId,
    visibility: item.visibility,
    transparency: item.transparency,
    createdAt: item.created,
    updatedAt: item.updated,
  }));

  return {
    items: events,
    nextPageToken: result.nextPageToken ?? null,
    source: "live",
  };
}

export async function createCalendarEvent(input: {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  attendees?: string[];
  colorId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  sendUpdates?: "all" | "externalOnly" | "none";
}): Promise<CalendarEvent> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");

  const event = await ctx.client.googlecalendar.api.events.create({
    calendarId: "primary",
    sendUpdates: input.sendUpdates ?? "all",
    event: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      status: "confirmed",
      start: input.isAllDay
        ? { date: input.start.split("T")[0] }
        : { dateTime: input.start },
      end: input.isAllDay
        ? { date: input.end.split("T")[0] }
        : { dateTime: input.end },
      attendees: input.attendees?.map((email) => ({ email })),
      colorId: input.colorId,
      visibility: input.visibility,
      transparency: input.transparency,
    },
  });

  return {
    id: event.id ?? "",
    summary: event.summary ?? "",
    description: event.description ?? "",
    location: event.location ?? "",
    status: event.status ?? "confirmed",
    start: event.start,
    end: event.end,
    isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
    })),
    htmlLink: event.htmlLink ?? "",
    calendarId: "primary",
    colorId: event.colorId,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    visibility: event.visibility,
    transparency: event.transparency,
    createdAt: event.created,
    updatedAt: event.updated,
  };
}

export async function updateCalendarEvent(input: {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  isAllDay?: boolean;
  attendees?: string[];
  colorId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  sendUpdates?: "all" | "externalOnly" | "none";
}): Promise<CalendarEvent> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");

  const fields: Record<string, unknown> = {};
  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined) fields.description = input.description;
  if (input.location !== undefined) fields.location = input.location;
  if (input.colorId !== undefined) fields.colorId = input.colorId;
  if (input.visibility !== undefined) fields.visibility = input.visibility;
  if (input.transparency !== undefined) fields.transparency = input.transparency;
  if (input.attendees !== undefined) {
    fields.attendees = input.attendees.map((email) => ({ email }));
  }
  if (input.start !== undefined) {
    fields.start = input.isAllDay
      ? { date: input.start.split("T")[0] }
      : { dateTime: input.start };
  }
  if (input.end !== undefined) {
    fields.end = input.isAllDay
      ? { date: input.end.split("T")[0] }
      : { dateTime: input.end };
  }

  const event = await ctx.client.googlecalendar.api.events.update({
    calendarId: "primary",
    id: input.id,
    event: fields,
    sendUpdates: input.sendUpdates ?? "all",
  });

  return {
    id: event.id ?? "",
    summary: event.summary ?? "",
    description: event.description ?? "",
    location: event.location ?? "",
    status: event.status ?? "confirmed",
    start: event.start,
    end: event.end,
    isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
    })),
    htmlLink: event.htmlLink ?? "",
    calendarId: "primary",
    colorId: event.colorId,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    visibility: event.visibility,
    transparency: event.transparency,
    createdAt: event.created,
    updatedAt: event.updated,
  };
}

export async function deleteCalendarEvent(input: {
  id: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}): Promise<void> {
  const ctx = await getClient();
  if (!ctx) throw new Error("Not authenticated");

  await ctx.client.googlecalendar.api.events.delete({
    calendarId: "primary",
    id: input.id,
    sendUpdates: input.sendUpdates ?? "all",
  });
}

export async function refreshCalendarEvents(opts: {
  timeMin: string;
  timeMax: string;
}): Promise<{ synced: number }> {
  const result = await getCalendarEvents({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    force: true,
  });
  return { synced: result.items.length };
}

export async function getCalendarList(): Promise<CalendarInfo[]> {
  const ctx = await getClient();
  if (!ctx) return [];

  try {
    // The corsair googlecalendar plugin doesn't have a calendar list endpoint,
    // so we return a default primary calendar entry.
    // TODO: When corsair adds calendar list support, fetch from API
    return [
      {
        id: "primary",
        summary: "Primary Calendar",
        description: "",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        selected: true,
      },
    ];
  } catch {
    return [];
  }
}
