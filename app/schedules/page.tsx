import { Bell, CalendarDays, CalendarRange, Keyboard, Mic, MoreHorizontal, Plus, Settings, UserCircle } from "lucide-react";

export default function SchedulesPage() {
  return (
    <main className="vf-shell min-h-screen overflow-x-hidden text-[#1c1b1b]">
      <nav className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col gap-6 border-r border-[#5f5f58]/10 bg-[#f6f3f2]/60 p-6 backdrop-blur-2xl md:flex">
        <div className="mb-6">
          <h1 className="text-5xl font-semibold tracking-tight">VocaFlow</h1>
          <p className="mt-2 text-xs font-medium uppercase tracking-widest text-[#49473f]">AI Voice Assistant</p>
        </div>
        <button className="flex w-full items-center justify-center gap-2 rounded-full bg-[#fff9e6] px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#767263]">
          <Plus className="h-4 w-4" />
          New Event
        </button>
        <div className="flex flex-1 flex-col gap-2">
          <a className="flex items-center gap-3 rounded-lg bg-[#fff9e6] p-3 font-semibold text-[#767263]" href="/schedules">
            <CalendarDays className="h-5 w-5" />
            <span>Day</span>
          </a>
          <a className="flex items-center gap-3 rounded-lg p-3 text-[#49473f]" href="/schedules">
            <CalendarRange className="h-5 w-5" />
            <span>Week</span>
          </a>
          <a className="flex items-center gap-3 rounded-lg p-3 text-[#49473f]" href="/">
            <CalendarRange className="h-5 w-5" />
            <span>Month</span>
          </a>
        </div>
        <a className="flex items-center gap-3 rounded-lg p-3 text-[#49473f]" href="/schedules">
          <Settings className="h-5 w-5" />
          <span>Settings</span>
        </a>
      </nav>

      <section className="min-h-screen pb-32 md:ml-64">
        <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-[#5f5f58]/10 bg-[#fcf9f8]/80 px-6 backdrop-blur-xl md:hidden">
          <h1 className="text-2xl font-semibold tracking-tight">VocaFlow</h1>
          <div className="flex gap-4 text-[#49473f]">
            <Bell className="h-5 w-5" />
            <UserCircle className="h-6 w-6" />
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-6 pt-12 md:px-16">
          <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">My Schedules</h2>
              <p className="mt-2 text-lg text-[#49473f]">Your upcoming tasks and meetings.</p>
            </div>
            <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2 md:mx-0 md:px-0">
              <button className="whitespace-nowrap rounded-full border border-transparent bg-[#313030] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#ffffff]">
                All
              </button>
              <button className="whitespace-nowrap rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#49473f]">
                Today
              </button>
              <button className="whitespace-nowrap rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#49473f]">
                Upcoming
              </button>
              <button className="whitespace-nowrap rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-6 py-2 text-xs font-medium uppercase tracking-widest text-[#49473f]">
                Completed
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <article className="vf-glass rounded-lg p-6 md:flex md:items-center md:gap-4">
              <div className="mb-4 shrink-0 md:mb-0 md:w-32">
                <span className="block text-xs font-medium uppercase tracking-widest text-[#49473f]">09:00 AM</span>
                <span className="text-xs font-medium uppercase tracking-widest text-[#5f5f58]">1h 30m</span>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-[#49473f]">
                    Work
                  </span>
                  <h3 className="text-lg font-semibold">Design Review: Apollo Project</h3>
                </div>
                <p className="text-[#49473f]">Review final mockups with the engineering team before handoff.</p>
              </div>
            </article>

            <article className="vf-glass rounded-lg p-6 md:flex md:items-center md:gap-4">
              <div className="mb-4 shrink-0 md:mb-0 md:w-32">
                <span className="block text-xs font-medium uppercase tracking-widest text-[#49473f]">11:30 AM</span>
                <span className="text-xs font-medium uppercase tracking-widest text-[#5f5f58]">45m</span>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#e8e2d0] bg-[#fff9e6] px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-[#625f50]">
                    Focus
                  </span>
                  <h3 className="text-lg font-semibold">Deep Work: Component Library</h3>
                </div>
                <p className="text-[#49473f]">Finalize the React components for the new design system.</p>
              </div>
            </article>

            <article className="vf-glass rounded-lg p-6 md:flex md:items-center md:gap-4">
              <div className="mb-4 shrink-0 md:mb-0 md:w-32">
                <span className="block text-xs font-medium uppercase tracking-widest text-[#49473f]">01:00 PM</span>
                <span className="text-xs font-medium uppercase tracking-widest text-[#5f5f58]">1h</span>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-[#49473f]">
                    Personal
                  </span>
                  <h3 className="text-lg font-semibold">Lunch with Sarah</h3>
                </div>
                <p className="text-[#49473f]">Meet at the new cafe down the street.</p>
              </div>
            </article>

            <article className="vf-glass rounded-lg p-6 opacity-60 md:flex md:items-center md:gap-4">
              <div className="mb-4 shrink-0 md:mb-0 md:w-32">
                <span className="block text-xs font-medium uppercase tracking-widest text-[#49473f] line-through">08:00 AM</span>
                <span className="text-xs font-medium uppercase tracking-widest text-[#5f5f58]">30m</span>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#e4e3da] bg-[#e5e2e1] px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-[#49473f]">
                    Work
                  </span>
                  <h3 className="text-lg font-semibold line-through">Daily Standup</h3>
                </div>
                <p className="text-[#49473f] line-through">Team sync.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <div className="fixed bottom-6 left-1/2 z-50 w-[90%] max-w-md -translate-x-1/2 md:ml-32">
        <div className="vf-glass flex items-center justify-between rounded-full border border-[#625f50]/20 p-2 shadow-sm">
          <button className="rounded-full p-3 text-[#49473f]">
            <Keyboard className="h-5 w-5" />
          </button>
          <button className="flex h-14 w-14 items-center justify-center rounded-full bg-[#313030] text-white shadow-lg">
            <Mic className="h-5 w-5" />
          </button>
          <button className="rounded-full p-3 text-[#49473f]">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </main>
  );
}
