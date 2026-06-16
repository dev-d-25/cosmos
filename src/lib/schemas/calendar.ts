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
  summary: z.string(),
  description: z.string(),
  location: z.string(),
  status: z.enum(["confirmed", "tentative", "cancelled"]),
  start: CalendarEventDateTimeSchema.optional(),
  end: CalendarEventDateTimeSchema.optional(),
  isAllDay: z.boolean(),
  attendees: z.array(CalendarEventAttendeeSchema),
  htmlLink: z.string(),
  calendarId: z.string(),
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
  summary: z.string(),
  description: z.string(),
  timeZone: z.string().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  selected: z.boolean(),
  accessRole: z.string().optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CalendarEventListResponse = z.infer<typeof CalendarEventListResponseSchema>;
export type CalendarInfo = z.infer<typeof CalendarInfoSchema>;
