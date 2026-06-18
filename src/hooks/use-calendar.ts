"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CalendarEventListResponseSchema,
  CalendarInfoSchema,
} from "@/server/calendar/schemas";
import type { CalendarEventListResponse, CalendarInfo } from "@/server/calendar/types";

// ─── API fetchers ──────────────────────────────────────────────────────────────

async function fetchCalendarEvents(opts: {
  timeMin: string;
  timeMax: string;
  calendarId?: string;
  refresh?: boolean;
}): Promise<CalendarEventListResponse> {
  const params = new URLSearchParams();
  params.set("timeMin", opts.timeMin);
  params.set("timeMax", opts.timeMax);
  if (opts.calendarId) params.set("calendarId", opts.calendarId);
  if (opts.refresh) params.set("refresh", "true");

  const res = await fetch(`/api/calendar/events?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch events (${res.status})`);
  }
  const json = await res.json();
  return CalendarEventListResponseSchema.parse(json);
}

async function fetchCalendarList(): Promise<CalendarInfo[]> {
  const res = await fetch("/api/calendar/calendars", { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch calendars (${res.status})`);
  }
  const json = await res.json();
  return z.array(CalendarInfoSchema).parse(json);
}

async function createCalendarEventApi(input: {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  colorId?: string;
  attendees?: string[];
}): Promise<{ id: string; htmlLink: string }> {
  const res = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to create event (${res.status})`);
  }
  return res.json();
}

async function deleteCalendarEventApi(input: {
  id: string;
}): Promise<void> {
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to delete event (${res.status})`);
  }
}

async function refreshCalendarEventsApi(input: {
  timeMin: string;
  timeMax: string;
}): Promise<{ synced: number }> {
  const res = await fetch("/api/calendar/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to refresh events (${res.status})`);
  }
  return res.json();
}

// ─── Query keys ────────────────────────────────────────────────────────────────

export const calendarKeys = {
  all: ["calendar"] as const,
  events: (opts: { timeMin: string; timeMax: string; calendarId?: string }) =>
    [...calendarKeys.all, "events", opts] as const,
  calendars: () => [...calendarKeys.all, "calendars"] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────────────

export function useCalendarEvents(opts: {
  timeMin: string;
  timeMax: string;
  calendarId?: string;
  initialData?: CalendarEventListResponse;
}) {
  return useQuery({
    queryKey: calendarKeys.events({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      calendarId: opts.calendarId,
    }),
    queryFn: () => fetchCalendarEvents(opts),
    initialData: opts.initialData,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCalendarList(initialData?: CalendarInfo[]) {
  return useQuery({
    queryKey: calendarKeys.calendars(),
    queryFn: fetchCalendarList,
    initialData,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCalendarEventApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCalendarEventApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useRefreshCalendarEvents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshCalendarEventsApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}
