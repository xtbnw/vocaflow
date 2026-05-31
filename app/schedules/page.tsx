"use client";

import { useMemo, useState } from "react";
import { isOnLocalDate, toTimestamp } from "@/backend/shared/timeUtils";
import { useCalendarEvents } from "@/frontend/hooks/useCalendarEvents";

type FilterKey = "all" | "today" | "upcoming";

export default function SchedulesPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const events = useCalendarEvents();

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const filteredEvents = useMemo(() => {
    let list = [...events];

    if (filter === "today") {
      list = list.filter((e) => isOnLocalDate(e.startAt, todayKey));
    } else if (filter === "upcoming") {
      const now = Date.now();
      list = list.filter((e) => toTimestamp(e.startAt) >= now);
    }

    list.sort((a, b) => toTimestamp(a.startAt) - toTimestamp(b.startAt));
    return list;
  }, [events, filter, todayKey]);

  return (
    <section className="min-h-screen pb-32 md:pl-24">
      <div className="mx-auto max-w-5xl px-6 pt-12 md:px-16 md:pt-24">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">My Schedules</h2>
            <p className="mt-2 text-lg text-[#49473f]">Your upcoming tasks and meetings.</p>
          </div>
          <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2 md:mx-0 md:px-0">
            {(
              [
                ["all", "All"],
                ["today", "Today"],
                ["upcoming", "Upcoming"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={
                  filter === key
                    ? "whitespace-nowrap rounded-full border border-transparent bg-[#313030] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#ffffff]"
                    : "whitespace-nowrap rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#49473f]"
                }
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="vf-glass rounded-lg p-12 text-center">
            <p className="text-sm text-[#49473f]/60">暂无日程安排</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredEvents.map((event) => {
              const startTime = new Date(event.startAt);
              const endTime = event.endAt ? new Date(event.endAt) : new Date(startTime.getTime() + 60 * 60 * 1000);
              const durationMin = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
              const hours = Math.floor(durationMin / 60);
              const minutes = durationMin % 60;
              const durationLabel =
                hours > 0 && minutes > 0
                  ? `${hours}h ${minutes}m`
                  : hours > 0
                    ? `${hours}h`
                    : `${minutes}m`;

              return (
                <article key={event.id} className="vf-glass rounded-lg p-6 md:flex md:items-center md:gap-4">
                  <div className="mb-4 shrink-0 md:mb-0 md:w-32">
                    <span className="block text-xs font-medium uppercase tracking-widest text-[#49473f]">
                      {String(startTime.getHours()).padStart(2, "0")}:{String(startTime.getMinutes()).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-widest text-[#5f5f58]">{durationLabel}</span>
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-[#49473f]">
                        {event.source === "voice" ? "Voice" : event.source === "manual" ? "Manual" : "Text"}
                      </span>
                      <h3 className="text-lg font-semibold">{event.title}</h3>
                    </div>
                    <p className="text-[#49473f]">
                      {event.location ? `@${event.location}` : ""}
                      {event.location && event.notes ? " — " : ""}
                      {event.notes ?? ""}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
