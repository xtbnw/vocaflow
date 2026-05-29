import { Bell, CalendarDays, CalendarRange, CalendarSearch, Mic, Plus, Send, Settings, UserCircle } from "lucide-react";

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const leadingDays = [24, 25, 26, 27, 28, 29, 30];
const monthDays = Array.from({ length: 31 }, (_, index) => index + 1);

export default function Home() {
  return (
    <main className="vf-shell min-h-screen overflow-x-hidden text-[#1c1b1b]">
      <nav className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-[#5f5f58]/10 bg-[#fcf9f8]/80 px-6 backdrop-blur-xl md:hidden">
        <div className="text-2xl font-semibold tracking-tight">VocaFlow</div>
        <div className="flex items-center gap-4 text-[#625f50]">
          <Bell className="h-5 w-5" />
          <UserCircle className="h-6 w-6" />
        </div>
      </nav>

      <aside className="group fixed left-0 top-0 z-40 hidden h-screen w-20 flex-col gap-6 overflow-hidden border-r border-[#5f5f58]/10 bg-[#f6f3f2]/60 p-6 backdrop-blur-2xl transition-[width] duration-300 hover:w-64 md:flex">
        <div className="h-12 text-5xl font-semibold tracking-tight opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          V
        </div>
        <div className="flex flex-col gap-2">
          <a className="flex items-center gap-4 rounded-lg p-3 text-[#49473f]" href="/schedules">
            <CalendarDays className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Day
            </span>
          </a>
          <a className="flex items-center gap-4 rounded-lg bg-[#fff9e6] p-3 font-semibold text-[#767263]" href="/">
            <CalendarRange className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Month
            </span>
          </a>
          <a className="flex items-center gap-4 rounded-lg p-3 text-[#49473f]" href="/">
            <CalendarSearch className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Year
            </span>
          </a>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          <button className="flex h-12 items-center justify-center gap-4 rounded-full bg-[#313030] px-3 text-[#f3f0ef] group-hover:justify-start">
            <Plus className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              New Event
            </span>
          </button>
          <a className="flex items-center gap-4 rounded-lg p-3 text-[#49473f]" href="/">
            <Settings className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap text-xs font-medium uppercase tracking-widest opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              Settings
            </span>
          </a>
        </div>
      </aside>

      <section className="mx-auto w-full max-w-5xl px-6 pb-48 pt-12 md:pl-28 md:pr-16 md:pt-24">
        <header className="mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-[#625f50]">October 2023</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Calendar</h1>
          </div>
          <div className="flex w-max rounded-full border border-[#e4e3da] bg-[#f6f3f2] p-1 shadow-sm">
            <button className="rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#49473f]">Year</button>
            <button className="rounded-full bg-[#fff9e6] px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#767263] shadow-sm">Month</button>
            <button className="rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#49473f]">Day</button>
          </div>
        </header>

        <div className="vf-glass mx-auto max-w-3xl rounded-2xl p-4 shadow-sm md:p-8">
          <div className="mb-6 grid grid-cols-7 gap-2 md:gap-4">
            {weekDays.map((day) => (
              <div className="text-center text-[11px] font-medium uppercase tracking-widest text-[#49473f]" key={day}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2 md:gap-4">
            {leadingDays.map((day) => (
              <div className="min-h-16 rounded-2xl p-2 opacity-30 md:min-h-28 md:p-3" key={`lead-${day}`}>
                <span className="text-sm text-[#49473f]">{day}</span>
              </div>
            ))}
            {monthDays.map((day) => (
              <div
                className={
                  day === 15
                    ? "relative min-h-16 rounded-2xl border border-[#e8e2d0] bg-[#fff9e6] p-2 shadow-sm md:min-h-28 md:p-3"
                    : "min-h-16 rounded-2xl border border-[#e4e3da] p-2 md:min-h-28 md:p-3"
                }
                key={day}
              >
                <span className={day === 15 ? "text-sm font-semibold text-[#767263]" : "text-sm text-[#1c1b1b]"}>
                  {day}
                </span>
                {day === 15 ? <span className="absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full bg-[#625f50]" /> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center px-4">
        <div className="vf-glass flex h-16 w-full max-w-md items-center gap-3 rounded-full p-1 pr-2 shadow-sm">
          <button className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/60 bg-[#fff9e6] text-[#625f50]">
            <Mic className="h-5 w-5" />
          </button>
          <input
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-[#1c1b1b] outline-none placeholder:text-[#49473f]/50"
            placeholder="Type custom intent..."
            type="text"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#313030] text-[#f3f0ef]">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </main>
  );
}
