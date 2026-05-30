"use client";

import { buildMonthGrid } from "@/frontend/components/calendar/buildMonthGrid";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "@/backend/domain/calendarTypes";

type ViewName = "year" | "month" | "day";

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currentDate = new Date();
const todayKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
const initialYear = currentDate.getFullYear();
const initialMonthIndex = currentDate.getMonth();
const yearOptions = Array.from({ length: 201 }, (_, index) => initialYear - 100 + index);

function toDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const eventColors = ["bg-[#fff9e6]", "bg-[#e5e2e1]", "bg-[#e8e2d0]", "bg-[#f0ebe5]"];

export default function Home() {
  const [activeView, setActiveView] = useState<ViewName>("month");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [displayYear, setDisplayYear] = useState(initialYear);
  const [displayMonthIndex, setDisplayMonthIndex] = useState(initialMonthIndex);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const loadEvents = () => {
    fetch("/api/events")
      .then((response) => response.json())
      .then((data: { events: CalendarEvent[] }) => setEvents(data.events));
  };

  useEffect(() => {
    loadEvents();
    window.addEventListener("vocaflow:events-changed", loadEvents);
    return () => window.removeEventListener("vocaflow:events-changed", loadEvents);
  }, []);

  const summariesByDay = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const event of events) {
      const d = new Date(event.startAt);
      if (d.getFullYear() === displayYear && d.getMonth() === displayMonthIndex) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        if (map[day].length < 3) map[day].push(event.title);
      }
    }
    return map;
  }, [events, displayYear, displayMonthIndex]);

  const selectedDayKey = selectedDay ? toDateKey(displayYear, displayMonthIndex, selectedDay) : null;

  const dayEvents = useMemo(() => {
    if (!selectedDayKey) return [];
    return events
      .filter((e) => e.startAt.startsWith(selectedDayKey))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [events, selectedDayKey]);

  const switchView = (viewName: ViewName, dayNum: number | null = null) => {
    setActiveView(viewName);
    if (viewName === "day" && dayNum === null && selectedDay === null) {
      setSelectedDay(effectiveDay);
    } else if (dayNum !== null) {
      setSelectedDay(dayNum);
    }
  };

  const selectYear = (year: number) => {
    setDisplayYear(year);
    setSelectedDay(null);
  };

  const selectMonth = (monthIndex: number) => {
    setDisplayMonthIndex(monthIndex);
    setSelectedDay(null);
  };

  const selectDay = (day: number) => {
    setSelectedDay(day);
  };

  const effectiveDay = selectedDay ?? (displayYear === initialYear && displayMonthIndex === initialMonthIndex ? currentDate.getDate() : 1);
  const daysInMonth = new Date(displayYear, displayMonthIndex + 1, 0).getDate();

  return (
    <>
      <main className="mx-auto w-full max-w-5xl px-6 pb-44 pt-8 transition-all duration-300 md:pl-24 md:pr-16 md:pt-16 lg:pl-24">
        <header className="mb-16 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="relative">
            {activeView === "year" ? (
              <WheelPicker
                options={yearOptions.map((year) => ({ label: String(year), value: year }))}
                value={displayYear}
                onSelect={selectYear}
              />
            ) : activeView === "month" ? (
              <WheelPicker
                options={monthNames.map((month, index) => ({ label: month, value: index }))}
                value={displayMonthIndex}
                onSelect={selectMonth}
              />
            ) : (
              <WheelPicker
                options={Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  return { label: `${displayMonthIndex + 1}-${day}`, value: day };
                })}
                value={effectiveDay}
                onSelect={selectDay}
              />
            )}
          </div>
          <div className="mt-4 flex self-start rounded-full border border-[#e4e3da]/80 bg-[#f6f3f2] p-1 shadow-sm md:mt-0 md:self-auto">
            <button className={toggleClass(activeView === "year")} onClick={() => switchView("year")}>
              Year
            </button>
            <button className={toggleClass(activeView === "month")} onClick={() => switchView("month")}>
              Month
            </button>
            <button className={toggleClass(activeView === "day")} onClick={() => switchView("day")}>
              Day
            </button>
          </div>
        </header>

        <section className="relative w-full">
          <ViewPanel active={activeView === "month"}>
            <MonthView monthIndex={displayMonthIndex} onSelectDay={(day) => switchView("day", day)} year={displayYear} summariesByDay={summariesByDay} todayKey={todayKey} />
          </ViewPanel>
          <ViewPanel active={activeView === "day"}>
            <DayView events={dayEvents} />
          </ViewPanel>
          <ViewPanel active={activeView === "year"}>
            <YearView
              monthIndex={displayMonthIndex}
              onSelectMonth={(monthIndex) => {
                selectMonth(monthIndex);
                switchView("month");
              }}
              year={displayYear}
            />
          </ViewPanel>
        </section>
      </main>

    </>
  );
}

function toggleClass(active: boolean) {
  return active
    ? "rounded-full bg-[#fff9e6] px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#767263] shadow-sm transition-colors"
    : "rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#49473f] transition-colors hover:bg-[#e5e2e1]/50";
}

function WheelPicker<T extends string | number>({
  onSelect,
  options,
  value,
}: {
  onSelect: (value: T) => void;
  options: { label: string; value: T }[];
  value: T;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ startY: number; startScroll: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const itemHeight = 44;

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    if (selectedIndex >= 0) {
      listRef.current?.scrollTo({ top: selectedIndex * itemHeight, behavior: "instant" });
    }
  }, [options, value]);

  const snapToNearest = () => {
    const list = listRef.current;
    if (!list) return;
    const idx = Math.min(options.length - 1, Math.max(0, Math.round(list.scrollTop / itemHeight)));
    list.scrollTo({ top: idx * itemHeight, behavior: "smooth" });
    const opt = options[idx];
    if (opt && opt.value !== value) onSelect(opt.value);
  };

  const handleScroll = () => {
    if (dragging) return;
    const list = listRef.current;
    if (!list) return;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const idx = Math.min(options.length - 1, Math.max(0, Math.round(list.scrollTop / itemHeight)));
      const opt = options[idx];
      if (opt && opt.value !== value) onSelect(opt.value);
    }, 80);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const list = listRef.current;
    if (!list) return;
    list.setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = { startY: e.clientY, startScroll: list.scrollTop };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const list = listRef.current;
    if (!list) return;
    const dy = dragRef.current.startY - e.clientY;
    list.scrollTop = dragRef.current.startScroll + dy;
  };

  const handlePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    snapToNearest();
  };

  return (
    <div className="absolute left-0 top-1/2 z-50 w-48 -translate-y-1/2 overflow-hidden">
      <div
        className={`vf-wheel-mask relative h-[84px] overflow-y-auto py-[14px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${dragging ? "" : "snap-y snap-mandatory"}`}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        ref={listRef}
        style={{ touchAction: "none" }}
      >
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              className={
                active
                  ? "relative z-20 flex h-11 w-full snap-center items-center justify-start text-5xl font-semibold leading-[56px] tracking-tight text-[#625f50] opacity-100 transition-opacity duration-150 ease-out"
                  : "relative z-20 flex h-11 w-full snap-center items-center justify-start text-5xl font-semibold leading-[56px] tracking-tight text-[#625f50] opacity-45 transition-opacity duration-150 ease-out"
              }
              key={String(option.value)}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ViewPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={active ? "relative w-full translate-y-0 opacity-100 transition-all duration-300" : "pointer-events-none absolute w-full translate-y-2.5 opacity-0 transition-all duration-300"}>
      {children}
    </div>
  );
}

function MonthView({ monthIndex, onSelectDay, year, summariesByDay, todayKey }: { monthIndex: number; onSelectDay: (day: number) => void; year: number; summariesByDay: Record<number, string[]>; todayKey: string }) {
  const monthCells = buildMonthGrid(year, monthIndex);

  return (
    <div className="vf-glass mx-auto mb-8 max-w-3xl rounded-3xl p-4 shadow-md md:p-6">
      <div className="mb-4 grid grid-cols-7 gap-2 md:gap-3">
        {weekDays.map((day) => (
          <div className="text-center text-xs font-medium uppercase tracking-widest text-[#49473f]" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2 md:gap-3">
        {monthCells.map((cell) => {
          const active = cell.isToday;
          const summary = cell.isCurrentMonth ? summariesByDay[cell.day] : null;

          if (!cell.isCurrentMonth) {
            return (
              <div className="flex h-16 flex-col items-start rounded-2xl p-2.5 opacity-30 md:h-20" key={cell.isoDate}>
                <span className="text-sm text-[#49473f]">{cell.day}</span>
              </div>
            );
          }

          return (
            <button
              className={
                active
                  ? "relative flex h-16 flex-col items-start overflow-hidden rounded-2xl border border-[#e8e2d0] bg-[#fff9e6] p-2.5 text-left shadow-sm transition-colors md:h-20"
                  : "group relative flex h-16 flex-col items-start overflow-hidden rounded-2xl border border-[#e4e3da]/80 p-2.5 text-left transition-colors hover:bg-[#e5e2e1]/30 md:h-20"
              }
              key={cell.isoDate}
              onClick={() => onSelectDay(cell.day)}
            >
              <span className={active ? "text-sm font-bold text-[#767263]" : "text-sm text-[#1c1b1b] transition-colors group-hover:text-[#625f50]"}>
                {cell.day}
              </span>
              {summary ? (
                <span className="mt-2 text-[10px] font-medium leading-tight text-[#49473f]/80 md:text-xs">
                  {summary.map((item) => (
                    <span className="block" key={item}>
                      {item}
                    </span>
                  ))}
                </span>
              ) : null}
              {active ? <span className="absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full bg-[#625f50]" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="vf-glass mx-auto max-w-2xl rounded-3xl p-6 shadow-md md:p-8">
        <p className="text-center text-sm text-[#49473f]/60">这一天暂无日程安排</p>
      </div>
    );
  }

  return (
    <div className="vf-glass mx-auto max-w-2xl rounded-3xl p-6 shadow-md md:p-8">
      <div className="flex flex-col gap-4">
        {events.map((event, index) => {
          const startAt = new Date(event.startAt);
          const endAt = event.endAt ? new Date(event.endAt) : new Date(startAt.getTime() + 60 * 60 * 1000);
          const timeLabel = `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`;
          const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60000);

          return (
            <div className="flex gap-4 rounded-2xl border border-[#e4e3da]/80 bg-white/40 p-4" key={event.id}>
              <div className="w-16 shrink-0 text-xs font-medium uppercase tracking-widest text-[#49473f]">{timeLabel}</div>
              <div className={`h-12 w-1.5 shrink-0 rounded-full ${eventColors[index % eventColors.length]}`} />
              <div className="flex flex-col gap-0.5">
                <div className="font-medium text-[#1c1b1b]">{event.title}</div>
                <span className="text-[10px] font-medium uppercase tracking-widest text-[#5f5f58]">{durationMin}min</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearView({
  monthIndex,
  onSelectMonth,
  year,
}: {
  monthIndex: number;
  onSelectMonth: (monthIndex: number) => void;
  year: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {monthNames.map((month, index) => {
        const active = index === monthIndex;
        const monthCells = buildMonthGrid(year, index);

        return (
          <button
            className={
              active
                ? "vf-glass rounded-lg border border-[#e8e2d0] bg-[#fff9e6] p-3 text-left shadow-sm transition-colors"
                : "vf-glass rounded-lg border border-[#e4e3da]/80 p-3 text-left transition-colors hover:bg-[#e5e2e1]/30"
            }
            key={month}
            onClick={() => onSelectMonth(index)}
          >
            <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-[#49473f]">{month}</h3>
            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {weekDays.map((day) => (
                <span className="text-center text-[8px] font-medium uppercase text-[#49473f]/50" key={day}>
                  {day.slice(0, 1)}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {monthCells.map((cell) => {
                const isSelectedMonthToday = active && cell.isToday;

                return (
                  <span
                    className={
                      isSelectedMonthToday
                        ? "flex aspect-square items-center justify-center rounded-full bg-[#625f50] text-[8px] font-semibold text-white"
                        : cell.isCurrentMonth
                          ? "flex aspect-square items-center justify-center rounded-sm text-[8px] font-medium text-[#1c1b1b]"
                          : "flex aspect-square items-center justify-center rounded-sm text-[8px] text-[#49473f]/25"
                    }
                    key={cell.isoDate}
                  >
                    {cell.day}
                  </span>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
