"use client";

import { Bell, Calendar, CalendarDays, CalendarRange, Mic, Plus, Settings, UserCircle, X } from "lucide-react";
import { useState } from "react";

type ViewName = "year" | "month" | "day";

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const leadingDays = [24, 25, 26, 27, 28, 29, 30];
const monthDays = Array.from({ length: 31 }, (_, index) => index + 1);
const summaries: Record<number, string[]> = {
  2: ["Team Sync"],
  5: ["Design Review"],
  8: ["Lunch w/ Alex"],
  12: ["All Hands"],
  15: ["Mentorship", "Gym"],
  18: ["Project Due"],
  22: ["1:1 Manager"],
  26: ["Dentist"],
};
const dayEvents = [
  { time: "09:00", title: "Morning standup", color: "bg-[#fff9e6]" },
  { time: "12:30", title: "Lunch w/ Alex", color: "bg-[#e5e2e1]" },
  { time: "18:00", title: "Gym session", color: "bg-[#fff9e6]" },
];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Home() {
  const [activeView, setActiveView] = useState<ViewName>("month");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [voiceExpanded, setVoiceExpanded] = useState(true);

  const switchView = (viewName: ViewName, dayNum: number | null = null) => {
    setActiveView(viewName);
    setSelectedDay(dayNum);
  };

  const header =
    activeView === "year"
      ? { title: "2023", subtitle: "Year Overview" }
      : activeView === "day"
        ? { title: selectedDay ? `October ${selectedDay}, 2023` : "Your Schedule", subtitle: "Day View" }
        : { title: "Calendar", subtitle: "October 2023" };

  return (
    <div className="vf-shell min-h-screen overflow-x-hidden text-[#1c1b1b]">
      <nav className="sticky top-0 z-50 flex h-20 w-full items-center justify-between border-b border-[#5f5f58]/10 bg-[#fcf9f8]/80 px-6 shadow-sm backdrop-blur-xl md:hidden">
        <div className="text-[28px] font-bold leading-9 tracking-tight">VocaFlow</div>
        <div className="flex items-center gap-4 text-[#625f50]">
          <Bell className="h-6 w-6" />
          <UserCircle className="h-7 w-7 fill-current" />
        </div>
      </nav>

      <aside className="group fixed left-0 top-0 z-40 hidden h-screen w-20 flex-col gap-6 overflow-hidden border-r border-[#5f5f58]/10 bg-[#f6f3f2]/60 p-6 backdrop-blur-2xl transition-[width] duration-300 ease-in-out hover:w-64 md:flex">
        <div className="mb-6 flex h-12 shrink-0 items-center">
          <div className="ml-2 whitespace-nowrap text-5xl font-semibold leading-[56px] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            V
          </div>
        </div>

        <nav className="flex w-full flex-col gap-2">
          <button className={sideNavClass(activeView === "day")} onClick={() => switchView("day")}>
            <CalendarDays className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Day
            </span>
          </button>
          <button className={sideNavClass(activeView === "month")} onClick={() => switchView("month")}>
            <CalendarRange className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Month
            </span>
          </button>
          <button className={sideNavClass(activeView === "year")} onClick={() => switchView("year")}>
            <Calendar className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Year
            </span>
          </button>
        </nav>

        <div className="mt-auto flex w-full flex-col gap-2">
          <button className="flex shrink-0 items-center justify-center gap-4 rounded-full bg-[#313030] p-3 text-[#f3f0ef] transition-transform duration-200 hover:translate-x-1 active:scale-95 group-hover:justify-start">
            <Plus className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              New Event
            </span>
          </button>
          <a className="flex shrink-0 items-center gap-4 rounded-lg p-3 text-[#49473f] transition-transform duration-200 hover:translate-x-1 hover:bg-[#e5e2e1]/30 active:scale-95" href="#">
            <Settings className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Settings
            </span>
          </a>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-6 pb-64 pt-12 transition-all duration-300 md:pl-24 md:pr-16 md:pt-24 lg:pl-24">
        <header className="mb-12 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-[#625f50]">{header.subtitle}</p>
            <h1 className="text-5xl font-semibold leading-[56px] tracking-tight text-[#1c1b1b]">{header.title}</h1>
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

        <section className="relative min-h-[60vh] w-full">
          <ViewPanel active={activeView === "month"}>
            <MonthView onSelectDay={(day) => switchView("day", day)} />
          </ViewPanel>
          <ViewPanel active={activeView === "day"}>
            <DayView />
          </ViewPanel>
          <ViewPanel active={activeView === "year"}>
            <YearView onSelectMonth={() => switchView("month")} />
          </ViewPanel>
        </section>
      </main>

      <div className="pointer-events-none fixed bottom-8 left-0 right-0 z-50 flex flex-col items-center gap-3 px-4">
        <div className={`vf-glass vf-voice-bar ambient-glow pointer-events-auto relative flex h-16 items-center overflow-hidden rounded-full p-1 ${voiceExpanded ? "expanded pr-6" : ""}`}>
          <button
            className={`z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/50 shadow-sm transition-all duration-300 hover:scale-105 ${voiceExpanded ? "bg-[#ffdad6] text-[#93000a]" : "pulse-ring bg-[#fff9e6] text-[#1e1c11]"}`}
            onClick={() => setVoiceExpanded((value) => !value)}
          >
            <Mic className="h-6 w-6 fill-current" />
          </button>
          <div className={`flex h-full flex-1 items-center justify-between pl-4 transition-opacity duration-300 ${voiceExpanded ? "opacity-100" : "opacity-0"}`}>
            <div className="flex h-6 w-16 shrink-0 items-end gap-1">
              {[24, 16, 24, 12, 20, 8].map((height, index) => (
                <div className="wave-bar w-1.5 rounded-full bg-[#625f50]" key={index} style={{ height }} />
              ))}
            </div>
            <div className="transcription-scroll relative ml-4 flex h-full flex-1 items-center overflow-hidden">
              <div className="absolute inset-0 flex items-center">
                <span className="animate-scroll whitespace-nowrap text-base text-[#1c1b1b]">
                  &quot;Schedule a gym session for tomorrow evening...&quot;
                </span>
              </div>
            </div>
            <button className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5e5e5d] transition-colors hover:bg-[#e5e2e1]/50" onClick={() => setVoiceExpanded(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function sideNavClass(active: boolean) {
  return active
    ? "flex shrink-0 items-center gap-4 rounded-lg bg-[#fff9e6] p-3 font-bold text-[#767263] transition-transform duration-200 hover:translate-x-1 active:scale-95"
    : "flex shrink-0 items-center gap-4 rounded-lg p-3 text-[#49473f] transition-transform duration-200 hover:translate-x-1 hover:bg-[#e5e2e1]/30 active:scale-95";
}

function toggleClass(active: boolean) {
  return active
    ? "rounded-full bg-[#fff9e6] px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#767263] shadow-sm transition-colors"
    : "rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#49473f] transition-colors hover:bg-[#e5e2e1]/50";
}

function ViewPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={active ? "relative w-full translate-y-0 opacity-100 transition-all duration-300" : "pointer-events-none absolute w-full translate-y-2.5 opacity-0 transition-all duration-300"}>
      {children}
    </div>
  );
}

function MonthView({ onSelectDay }: { onSelectDay: (day: number) => void }) {
  return (
    <div className="vf-glass mx-auto mb-12 max-w-3xl rounded-3xl p-4 shadow-md md:p-8">
      <div className="mb-6 grid grid-cols-7 gap-2 md:gap-4">
        {weekDays.map((day) => (
          <div className="text-center text-xs font-medium uppercase tracking-widest text-[#49473f]" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2 md:gap-4">
        {leadingDays.map((day) => (
          <div className="flex flex-col items-start rounded-2xl p-3 opacity-30" key={`lead-${day}`}>
            <span className="text-sm text-[#49473f]">{day}</span>
          </div>
        ))}
        {monthDays.map((day) => {
          const active = day === 15;
          return (
            <button
              className={
                active
                  ? "relative flex h-20 flex-col items-start overflow-hidden rounded-2xl border border-[#e8e2d0] bg-[#fff9e6] p-3 text-left shadow-sm transition-colors md:h-28"
                  : "group relative flex h-20 flex-col items-start overflow-hidden rounded-2xl border border-[#e4e3da]/80 p-3 text-left transition-colors hover:bg-[#e5e2e1]/30 md:h-28"
              }
              key={day}
              onClick={() => onSelectDay(day)}
            >
              <span className={active ? "text-sm font-bold text-[#767263]" : "text-sm text-[#1c1b1b] transition-colors group-hover:text-[#625f50]"}>
                {day}
              </span>
              {summaries[day] ? (
                <span className="mt-2 text-[10px] font-medium leading-tight text-[#49473f]/80 md:text-xs">
                  {summaries[day].map((item) => (
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

function DayView() {
  return (
    <div className="vf-glass mx-auto max-w-2xl rounded-3xl p-6 shadow-md md:p-8">
      <div className="flex flex-col gap-4">
        {dayEvents.map((event) => (
          <div className="flex gap-4 rounded-2xl border border-[#e4e3da]/80 bg-white/40 p-4" key={event.time}>
            <div className="w-16 shrink-0 text-xs font-medium uppercase tracking-widest text-[#49473f]">{event.time}</div>
            <div className={`h-12 w-1.5 shrink-0 rounded-full ${event.color}`} />
            <div className="font-medium text-[#1c1b1b]">{event.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function YearView({ onSelectMonth }: { onSelectMonth: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {months.map((month) => {
        const active = month === "Oct";
        return (
          <button
            className={
              active
                ? "vf-glass rounded-lg border border-[#e8e2d0] bg-[#fff9e6] p-4 text-left shadow-sm transition-colors"
                : "vf-glass rounded-lg border border-[#e4e3da]/80 p-4 text-left transition-colors hover:bg-[#e5e2e1]/30"
            }
            key={month}
            onClick={onSelectMonth}
          >
            <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#49473f]">{month}</h3>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 30 }, (_, index) => (
                <span
                  className={`aspect-square rounded-sm ${active && index === 14 ? "bg-[#625f50]" : "bg-[#e5e2e1]"} opacity-50`}
                  key={index}
                />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
