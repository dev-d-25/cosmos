import { z } from "zod";

export const CalendarEventDateTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

export const CalendarEventAttendeeSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
  self: z.boolean().optional(),
});

export const CalendarEventSchema = z.object({
  id: z.string(),
  summary: z.string().optional().default(""),
  description: z.string().optional().default(""),
  location: z.string().optional().default(""),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional().default("confirmed"),
  start: CalendarEventDateTimeSchema.optional(),
  end: CalendarEventDateTimeSchema.optional(),
  isAllDay: z.boolean().optional().default(false),
  attendees: z.array(CalendarEventAttendeeSchema).optional().default([]),
  htmlLink: z.string().optional().default(""),
  calendarId: z.string().optional().default("primary"),
  colorId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const CalendarEventListResponseSchema = z.object({
  items: z.array(CalendarEventSchema),
  nextPageToken: z.string().nullable().optional(),
  source: z.enum(["cache", "live"]),
});

export const CalendarInfoSchema = z.object({
  id: z.string(),
  summary: z.string().optional().default(""),
  description: z.string().optional().default(""),
  timeZone: z.string().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  selected: z.boolean().optional().default(true),
  accessRole: z.string().optional(),
});

export const CalendarEventsQuerySchema = z.object({
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
  calendarId: z.string().optional().default("primary"),
  refresh: z.enum(["true", "false"]).default("false"),
});

export const CalendarCreateEventSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string(),
  end: z.string(),
  isAllDay: z.boolean().optional().default(false),
  colorId: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional().default("all"),
});

export const CalendarUpdateEventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  isAllDay: z.boolean().optional(),
  colorId: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional().default("all"),
});

export const CalendarDeleteEventSchema = z.object({
  id: z.string(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional().default("all"),
});

export const CalendarRefreshResponseSchema = z.object({
  synced: z.number().int().nonnegative(),
});
