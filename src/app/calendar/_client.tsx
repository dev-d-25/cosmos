"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, subDays, startOfWeek, endOfWeek, format, isSameDay, parseISO, startOfMonth, endOfMonth } from "date-fns";

import { SignOutButton } from "@/components/auth-buttons";
import { ConnectButton } from "@/components/connect-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { ThemeToggle } from "@/components/theme-toggle";
import type { CalendarEvent, CalendarEventListResponse, CalendarInfo, CalendarPageData } from "@/server/calendar/types";
import {
  useCalendarEvents,
  useCalendarList,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useRefreshCalendarEvents,
} from "@/hooks/use-calendar";

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const VIEW_OPTIONS = ["day", "week", "month"] as const;
type ViewMode = (typeof VIEW_OPTIONS)[number];

// ─── Top Navigation ───────────────────────────────────────────────────────────

function CalendarTopNav({
  onRefresh,
  isRefreshing,
  onSearchOpen,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
  onSearchOpen: () => void;
}) {
  return (
    <nav className="border-border bg-card flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="flex gap-0.5 text-xs font-medium">
        <Link
          href="/mail"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Mail
        </Link>
        <Link
          href="/calendar"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "bg-muted" })}
        >
          Calendar
        </Link>
        <Link
          href="/agent"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Agent
        </Link>
      </div>

      <div className="relative min-w-0 flex-1">
        <svg
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-8 w-full rounded-none border px-3 pr-14 pl-8 text-xs outline-none"
          placeholder="Search events, people, or ask AI..."
          onMouseDown={(e) => {
            e.preventDefault();
            onSearchOpen();
          }}
          readOnly
        />
        <span className="absolute top-1/2 right-2 -translate-y-1/2">
          <Kbd className="text-[0.625rem]">Cmd K</Kbd>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="bg-border h-5 w-px" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh calendar"
          className="size-8"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh calendar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </Button>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </nav>
  );
}

// ─── Mini Calendar (Sidebar) ──────────────────────────────────────────────────

function MiniCalendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}) {
  const [viewDate, setViewDate] = useState(selectedDate);
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  let d = calStart;
  while (d <= calEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setViewDate(subDays(viewDate, 30))}
          className="text-muted-foreground hover:text-foreground size-6"
        >
          ‹
        </button>
        <span className="text-xs font-medium">{format(viewDate, "MMMM yyyy")}</span>
        <button
          onClick={() => setViewDate(addDays(viewDate, 30))}
          className="text-muted-foreground hover:text-foreground size-6"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-muted-foreground py-1 text-center text-[10px] font-medium">
            {d}
          </div>
        ))}
        {days.map((day, i) => {
          const isToday = isSameDay(day, new Date());
          const isSelected = isSameDay(day, selectedDate);
          const isCurrentMonth = day.getMonth() === viewDate.getMonth();
          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "size-7 rounded-full text-[11px] flex items-center justify-center transition-colors",
                !isCurrentMonth && "text-muted-foreground/40",
                isCurrentMonth && !isToday && !isSelected && "text-foreground hover:bg-muted",
                isToday && !isSelected && "bg-primary text-primary-foreground font-bold",
                isSelected && "bg-primary text-primary-foreground font-bold",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Calendar Sidebar ─────────────────────────────────────────────────────────

function CalendarSidebar({
  calendars,
  selectedDate,
  onSelectDate,
  calendarConnected,
}: {
  calendars: CalendarInfo[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  calendarConnected: boolean;
}) {
  return (
    <aside className="border-border flex w-56 shrink-0 flex-col border-r">
      {!calendarConnected && (
        <div className="p-3">
          <ConnectButton plugin="googlecalendar" />
        </div>
      )}
      <MiniCalendar selectedDate={selectedDate} onSelectDate={onSelectDate} />
      <div className="border-border border-t p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">My Calendars</div>
        {calendars.map((cal) => (
          <label
            key={cal.id}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted cursor-pointer"
          >
            <input
              type="checkbox"
              defaultChecked={cal.selected}
              className="accent-primary size-3 rounded"
            />
            <span className="truncate">{cal.summary}</span>
          </label>
        ))}
      </div>
    </aside>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function getWeekDays(centerDate: Date): Date[] {
  const start = startOfWeek(centerDate, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function EventCard({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const startStr = event.start?.dateTime ?? event.start?.date;
  const endStr = event.end?.dateTime ?? event.end?.date;
  if (!startStr) return null;

  const startDate = parseISO(startStr);
  const endDate = endStr ? parseISO(endStr) : startDate;

  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const durationMinutes = Math.max(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60),
    15,
  );

  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 20);

  return (
    <button
      onClick={onClick}
      className={cn(
        "absolute left-1 right-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-90",
        "bg-primary/15 text-primary border border-primary/20",
      )}
      style={{ top: `${top}px`, height: `${height}px` }}
    >
      <div className="font-medium truncate">{event.summary || "Untitled"}</div>
      {height > 30 && (
        <div className="text-muted-foreground truncate text-[10px]">
          {format(startDate, "h:mm a")}
        </div>
      )}
    </button>
  );
}

function WeekView({
  events,
  weekDays,
  onEventClick,
}: {
  events: CalendarEvent[];
  weekDays: Date[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of weekDays) {
      map.set(format(day, "yyyy-MM-dd"), []);
    }
    for (const event of events) {
      const startStr = event.start?.dateTime ?? event.start?.date;
      if (!startStr) continue;
      const dayKey = format(parseISO(startStr), "yyyy-MM-dd");
      const arr = map.get(dayKey);
      if (arr) arr.push(event);
    }
    return map;
  }, [events, weekDays]);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

  return (
    <div className="flex flex-1 overflow-auto">
      {/* Time labels column */}
      <div className="w-14 shrink-0">
        <div className="h-10" />
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="text-muted-foreground relative"
            style={{ height: `${HOUR_HEIGHT}px` }}
          >
            <span className="absolute -top-2.5 right-2 text-[10px]">
              {hour === 0 ? "" : format(new Date(2000, 0, 1, hour), "h a")}
            </span>
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="flex flex-1">
        {weekDays.map((day, dayIdx) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const isToday = isSameDay(day, now);
          const dayEvents = eventsByDay.get(dayKey) ?? [];

          return (
            <div key={dayIdx} className="border-border flex-1 border-r last:border-r-0">
              {/* Day header */}
              <div className={cn("border-border h-10 border-b text-center", isToday && "bg-primary/5")}>
                <div className="text-muted-foreground text-[10px] uppercase">
                  {format(day, "EEE")}
                </div>
                <div
                  className={cn(
                    "mx-auto flex size-6 items-center justify-center rounded-full text-xs font-medium",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </div>
              </div>

              {/* Hour grid */}
              <div className="relative">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-border border-b"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Now line */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="bg-primary flex items-center">
                      <div className="bg-primary size-2 rounded-full -ml-1" />
                      <div className="bg-primary h-px flex-1" />
                    </div>
                  </div>
                )}

                {/* Events */}
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onClick={() => onEventClick(event)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({
  events,
  day,
  onEventClick,
}: {
  events: CalendarEvent[];
  day: Date;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const dayKey = format(day, "yyyy-MM-dd");
  const dayEvents = events.filter((e) => {
    const startStr = e.start?.dateTime ?? e.start?.date;
    return startStr && format(parseISO(startStr), "yyyy-MM-dd") === dayKey;
  });

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
  const isToday = isSameDay(day, now);

  return (
    <div className="flex flex-1 overflow-auto">
      <div className="w-14 shrink-0">
        <div className="h-6" />
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="text-muted-foreground relative"
            style={{ height: `${HOUR_HEIGHT}px` }}
          >
            <span className="absolute -top-2.5 right-2 text-[10px]">
              {hour === 0 ? "" : format(new Date(2000, 0, 1, hour), "h a")}
            </span>
          </div>
        ))}
      </div>

      <div className="relative flex-1">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="border-border border-b"
            style={{ height: `${HOUR_HEIGHT}px` }}
          />
        ))}

        {isToday && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10"
            style={{ top: `${nowTop}px` }}
          >
            <div className="bg-primary flex items-center">
              <div className="bg-primary size-2 rounded-full -ml-1" />
              <div className="bg-primary h-px flex-1" />
            </div>
          </div>
        )}

        {dayEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onClick={() => onEventClick(event)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Create Event Dialog ──────────────────────────────────────────────────────

function CreateEventDialog({
  open,
  onClose,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate?: Date;
}) {
  const createEvent = useCreateCalendarEvent();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const d = defaultDate ?? new Date();
    return format(d, "yyyy-MM-dd'T'HH:mm");
  });
  const [endDate, setEndDate] = useState(() => {
    const d = defaultDate ?? new Date();
    d.setHours(d.getHours() + 1);
    return format(d, "yyyy-MM-dd'T'HH:mm");
  });
  const [isAllDay, setIsAllDay] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await createEvent.mutateAsync({
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: isAllDay ? `${startDate.split("T")[0]}T00:00:00` : startDate,
      end: isAllDay ? `${endDate.split("T")[0]}T23:59:59` : endDate,
      isAllDay,
    });
    setTitle("");
    setDescription("");
    setLocation("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-semibold">Create Event</h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-border bg-background w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="accent-primary"
            />
            All day
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-muted-foreground mb-1 block text-[10px]">Start</label>
              <input
                type={isAllDay ? "date" : "datetime-local"}
                value={isAllDay ? startDate.split("T")[0] : startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-border bg-background w-full rounded border px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-[10px]">End</label>
              <input
                type={isAllDay ? "date" : "datetime-local"}
                value={isAllDay ? endDate.split("T")[0] : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border-border bg-background w-full rounded border px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <input
            type="text"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="border-border bg-background w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="border-border bg-background w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!title.trim() || createEvent.isPending}>
            {createEvent.isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Event Detail Popover ─────────────────────────────────────────────────────

function EventDetailPopover({
  event,
  onClose,
  onDelete,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  if (!event) return null;

  const startStr = event.start?.dateTime ?? event.start?.date;
  const endStr = event.end?.dateTime ?? event.end?.date;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border-border w-full max-w-sm rounded-lg border p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-sm font-semibold">{event.summary || "Untitled Event"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">
            ✕
          </button>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          {startStr && (
            <div>
              {format(parseISO(startStr), event.isAllDay ? "MMM d, yyyy" : "MMM d, yyyy h:mm a")}
              {endStr && ` — ${format(parseISO(endStr), event.isAllDay ? "MMM d, yyyy" : "h:mm a")}`}
            </div>
          )}
          {event.location && <div>📍 {event.location}</div>}
          {event.description && <div className="whitespace-pre-wrap">{event.description}</div>}
          {event.attendees.length > 0 && (
            <div>
              <div className="font-medium text-foreground mb-1">Attendees</div>
              {event.attendees.map((a, i) => (
                <div key={i}>
                  {a.displayName ?? a.email}
                  {a.responseStatus && ` (${a.responseStatus})`}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(event.id);
              onClose();
            }}
          >
            Delete
          </Button>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium bg-transparent text-foreground hover:bg-muted transition-colors"
            >
              Open in Google
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Calendar Interface ──────────────────────────────────────────────────

export function CalendarInterface({
  initial,
  initialView,
  initialTimeMin,
  initialTimeMax,
  connectedPlugin,
}: {
  initial: CalendarPageData;
  initialView: string;
  initialTimeMin: string;
  initialTimeMax: string;
  connectedPlugin?: string;
}) {
  const router = useRouter();
  const calendarConnected =
    initial.calendarConnected || connectedPlugin === "googlecalendar";

  const [view, setView] = useState<ViewMode>(
    (initialView as ViewMode) || "week",
  );
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Compute time range based on view and selected date
  const { timeMin, timeMax, weekDays } = useMemo(() => {
    if (view === "day") {
      const dayStart = new Date(selectedDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(selectedDate);
      dayEnd.setHours(23, 59, 59, 999);
      return {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        weekDays: [selectedDate],
      };
    }
    if (view === "month") {
      const monthStart = startOfMonth(selectedDate);
      const monthEnd = endOfMonth(selectedDate);
      const days = getWeekDays(monthStart);
      // For month view, get all weeks
      const allDays: Date[] = [];
      let d = startOfWeek(monthStart, { weekStartsOn: 0 });
      const mEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
      while (d <= mEnd) {
        allDays.push(d);
        d = addDays(d, 1);
      }
      return {
        timeMin: monthStart.toISOString(),
        timeMax: monthEnd.toISOString(),
        weekDays: allDays,
      };
    }
    // week
    const days = getWeekDays(selectedDate);
    const weekStart = days[0] ?? selectedDate;
    const weekEnd = days[6] ?? selectedDate;
    return {
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
      weekDays: days,
    };
  }, [view, selectedDate]);

  const { data: eventsData, isLoading } = useCalendarEvents({
    timeMin,
    timeMax,
    initialData: initial.calendarConnected
      ? initial.events
      : undefined,
  });

  const { mutate: refreshEvents, isPending: isRefreshing } =
    useRefreshCalendarEvents();
  const { mutate: deleteEvent } = useDeleteCalendarEvent();

  const events = eventsData?.items ?? [];

  const handleRefresh = useCallback(() => {
    refreshEvents({ timeMin, timeMax });
  }, [refreshEvents, timeMin, timeMax]);

  const handlePrev = useCallback(() => {
    if (view === "day") setSelectedDate((d) => subDays(d, 1));
    else if (view === "week") setSelectedDate((d) => subDays(d, 7));
    else setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, [view]);

  const handleNext = useCallback(() => {
    if (view === "day") setSelectedDate((d) => addDays(d, 1));
    else if (view === "week") setSelectedDate((d) => addDays(d, 7));
    else setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, [view]);

  const handleToday = useCallback(() => {
    setSelectedDate(new Date());
  }, []);

  const dateLabel = useMemo(() => {
    if (view === "day") return format(selectedDate, "MMMM d, yyyy");
    if (view === "week") {
      const days = getWeekDays(selectedDate);
      const first = days[0] ?? selectedDate;
      const last = days[6] ?? selectedDate;
      return `${format(first, "MMM d")} — ${format(last, "MMM d, yyyy")}`;
    }
    return format(selectedDate, "MMMM yyyy");
  }, [view, selectedDate]);

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <CalendarTopNav
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onSearchOpen={() => {}}
      />

      <div className="flex flex-1 overflow-hidden">
        <CalendarSidebar
          calendars={initial.calendarConnected ? initial.calendars : []}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          calendarConnected={calendarConnected}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Calendar toolbar */}
          <div className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-4">
            <Button variant="ghost" size="sm" onClick={handleToday}>
              Today
            </Button>
            <button
              onClick={handlePrev}
              className="text-muted-foreground hover:text-foreground size-6"
            >
              ‹
            </button>
            <button
              onClick={handleNext}
              className="text-muted-foreground hover:text-foreground size-6"
            >
              ›
            </button>
            <span className="text-sm font-medium">{dateLabel}</span>

            <div className="ml-auto flex items-center gap-1">
              {VIEW_OPTIONS.map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium capitalize transition-colors",
                    view === v
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="bg-border h-5 w-px" />

            <Button
              size="sm"
              onClick={() => setCreateDialogOpen(true)}
              className="gap-1"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Event
            </Button>
          </div>

          {/* Calendar content */}
          {!calendarConnected ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground mb-4 text-sm">
                  Connect your Google Calendar to get started
                </p>
                <ConnectButton plugin="googlecalendar" />
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-muted-foreground text-sm">Loading events...</span>
            </div>
          ) : view === "day" ? (
            <DayView
              events={events}
              day={selectedDate}
              onEventClick={setSelectedEvent}
            />
          ) : (
            <WeekView
              events={events}
              weekDays={weekDays}
              onEventClick={setSelectedEvent}
            />
          )}
        </main>
      </div>

      <CreateEventDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        defaultDate={selectedDate}
      />

      {selectedEvent && (
        <EventDetailPopover
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={(id) => deleteEvent({ id })}
        />
      )}
    </div>
  );
}
