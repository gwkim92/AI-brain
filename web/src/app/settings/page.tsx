"use client";

import React from "react";

import { SettingsModule } from "@/components/modules/SettingsModule";

export default function SettingsPage() {
  return (
    <main className="min-h-0 overflow-hidden rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 text-neutral-950 shadow-sm">
      <div
        data-testid="settings-scroll-container"
        className="h-full min-h-0 overflow-y-auto rounded-[24px] border border-black/10 bg-white"
      >
        <SettingsModule />
      </div>
    </main>
  );
}
