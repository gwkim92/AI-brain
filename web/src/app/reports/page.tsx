"use client";

import React from "react";

import { ReportsModule } from "@/components/modules/ReportsModule";

export default function ReportsPage() {
  return (
    <main className="w-full h-full min-h-0 bg-black/40 text-white p-6">
      <div className="h-full min-h-0 rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm overflow-hidden">
        <ReportsModule />
      </div>
    </main>
  );
}
