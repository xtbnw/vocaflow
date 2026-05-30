export default function SchedulesPage() {
  return (
    <>
      <section className="min-h-screen pb-32 md:pl-24">
        <div className="mx-auto max-w-5xl px-6 pt-12 md:px-16 md:pt-24">
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
    </>
  );
}
