"use client";

import Link from "next/link";
import React from "react";

import { Jarvis3DCore } from "@/components/ui/Jarvis3DCore";
import type { Jarvis3DBaseMode } from "@/lib/visual-core/types";

type StudioSurfaceProps = {
  title: string;
  subtitle: string;
  baseMode: Jarvis3DBaseMode;
  children: React.ReactNode;
};

const NAV_ITEMS = [
  { href: "/studio", label: "WORKSPACE" },
  { href: "/studio/code", label: "CODE" },
  { href: "/studio/research", label: "RESEARCH" },
  { href: "/studio/finance", label: "FINANCE" },
  { href: "/studio/news", label: "NEWS" },
  { href: "/studio?widget=inbox", label: "HUD" },
];

export function StudioSurface({ title, subtitle, baseMode, children }: StudioSurfaceProps) {
  return (
    <main className="relative w-full h-full overflow-hidden text-white">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Jarvis3DCore hideUI baseMode={baseMode} overlayFx={["event_ripple"]} />
      </div>
      <div className="absolute inset-0 z-10 bg-black/50" />

      <div className="relative z-20 w-full h-full p-6 lg:p-8 flex flex-col gap-4 overflow-y-auto">
        <header className="border border-cyan-500/30 bg-black/45 backdrop-blur-xl rounded-xl p-4 lg:p-5">
          <p className="text-[10px] font-mono tracking-[0.28em] text-cyan-300/80">JARVIS STUDIO</p>
          <h1 className="mt-2 text-2xl lg:text-3xl font-mono font-bold tracking-widest text-cyan-200">{title}</h1>
          <p className="mt-1 text-xs lg:text-sm font-mono text-white/65">{subtitle}</p>

          <nav className="mt-4 flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 rounded border border-white/20 bg-black/40 text-[10px] font-mono tracking-widest text-white/80 hover:text-cyan-200 hover:border-cyan-400/40"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <section className="border border-white/15 bg-black/35 backdrop-blur-xl rounded-xl p-4 lg:p-5 min-h-0 flex-1">
          {children}
        </section>
      </div>
    </main>
  );
}
