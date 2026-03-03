"use client";

import React from "react";

import { SettingsModule } from "@/components/modules/SettingsModule";

export default function SettingsPage() {
  return (
    <main className="w-full h-full min-h-0 overflow-hidden bg-black/40 text-white p-6">
      <div
        data-testid="settings-scroll-container"
        className="h-full min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm"
      >
        <SettingsModule />
      </div>
    </main>
  );
}
