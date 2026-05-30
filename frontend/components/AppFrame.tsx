"use client";

import { Bell, CalendarDays, Home, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { VoiceCommandBar } from "@/frontend/components/VoiceCommandBar";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "首页", icon: Home, active: pathname === "/" },
    { href: "/schedules", label: "日程页", icon: CalendarDays, active: pathname.startsWith("/schedules") },
  ];

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
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link className={sideNavClass(item.active)} href={item.href} key={item.href}>
                <Icon className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap text-xs font-medium tracking-[0.05em] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {children}
      <VoiceCommandBar />
    </div>
  );
}

function sideNavClass(active: boolean) {
  return active
    ? "flex shrink-0 items-center gap-4 rounded-lg bg-[#fff9e6] p-3 font-bold text-[#767263] transition-transform duration-200 hover:translate-x-1 active:scale-95"
    : "flex shrink-0 items-center gap-4 rounded-lg p-3 text-[#49473f] transition-transform duration-200 hover:translate-x-1 hover:bg-[#e5e2e1]/30 active:scale-95";
}
