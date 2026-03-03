"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelRight, X } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { RightPanel } from "@/components/layout/RightPanel";
import { Jarvis3DCore } from "@/components/ui/Jarvis3DCore";
import { CommandBar } from "@/components/ui/CommandBar";
import { useHUD } from "@/components/providers/HUDProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { visualCoreScene } = useHUD();
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isCorePage = pathname === "/core";
  const [overlayOpen, setOverlayOpen] = useState(false);

  const toggle = useCallback(() => setOverlayOpen((v) => !v), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  if (isAuthPage) {
    return <div className="h-screen w-full overflow-y-auto overflow-x-hidden">{children}</div>;
  }

  return (
    <div className="flex flex-row h-screen w-full overflow-hidden">
      {!isCorePage && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <Jarvis3DCore
            hideUI
            baseMode={visualCoreScene?.baseMode ?? "default"}
            overlayFx={visualCoreScene?.overlayFx ?? []}
            highVisibility
          />
        </div>
      )}
      <div className="fixed top-0 left-0 right-0 z-[80] pointer-events-none">
        <CommandBar />
      </div>
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {children}

        {/* Overlay trigger for < 2xl */}
        {!isCorePage && (
          <button
            onClick={toggle}
            className="fixed bottom-4 right-4 z-50 2xl:hidden p-2.5 rounded-full bg-black/70 border border-white/15 text-white/60 hover:text-white hover:border-cyan-500/40 backdrop-blur-md shadow-lg transition-all"
            title="Toggle panel (Ctrl+.)"
          >
            <PanelRight size={18} />
          </button>
        )}
      </div>

      {/* Static panel for >= 2xl */}
      {!isCorePage && (
        <div className="hidden 2xl:block w-80 shrink-0 h-full border-l border-white/10 bg-black/50 backdrop-blur-xl relative z-40 overflow-y-auto">
          <RightPanel />
        </div>
      )}

      {/* Overlay panel for < 2xl */}
      {!isCorePage && overlayOpen && (
        <>
          <div
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm 2xl:hidden"
            onClick={() => setOverlayOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-[91] w-80 bg-black/90 border-l border-white/10 backdrop-blur-xl overflow-y-auto 2xl:hidden animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <span className="text-xs font-mono text-white/50 tracking-wider">PANEL</span>
              <button
                onClick={() => setOverlayOpen(false)}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <RightPanel />
          </div>
        </>
      )}
    </div>
  );
}
