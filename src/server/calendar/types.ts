import type { z } from "zod";
import type {
  CalendarEventSchema,
  CalendarEventListResponseSchema,
  CalendarInfoSchema,
} from "./schemas";

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CalendarEventListResponse = z.infer<typeof CalendarEventListResponseSchema>;
export type CalendarInfo = z.infer<typeof CalendarInfoSchema>;

export type CalendarPageData =
  | { tenantId: string; calendarConnected: false }
  | {
      tenantId: string;
      calendarConnected: true;
      events: CalendarEventListResponse;
      calendars: CalendarInfo[];
    };
