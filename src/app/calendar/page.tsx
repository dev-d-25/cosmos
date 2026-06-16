import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCalendarPageData } from "@/server/calendar";
import { CalendarInterface } from "./_client";

type SearchParams = Promise<{
  date?: string;
  view?: string;
  connected?: string;
}>;

async function CalendarPageInner({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = sp?.view ?? "week";
  const connected = sp?.connected;

  // Compute default time range based on view
  const now = new Date();
  let timeMin: string;
  let timeMax: string;

  if (view === "day") {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    timeMin = dayStart.toISOString();
    timeMax = dayEnd.toISOString();
  } else if (view === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    timeMin = monthStart.toISOString();
    timeMax = monthEnd.toISOString();
  } else {
    // week view (default)
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    timeMin = weekStart.toISOString();
    timeMax = weekEnd.toISOString();
  }

  const data = await getCalendarPageData({ timeMin, timeMax });
  if (!data) redirect("/");

  return (
    <CalendarInterface
      initial={data}
      initialView={view}
      initialTimeMin={timeMin}
      initialTimeMax={timeMax}
      connectedPlugin={connected}
    />
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="bg-background text-foreground flex h-screen items-center justify-center">
          Loading calendar...
        </div>
      }
    >
      <CalendarPageInner searchParams={searchParams} />
    </Suspense>
  );
}
