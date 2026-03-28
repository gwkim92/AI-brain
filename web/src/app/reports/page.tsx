"use client";

import React from "react";

import { ReportsModule } from "@/components/modules/ReportsModule";

export default function ReportsPage() {
  return (
    <main className="min-h-full rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
      <div className="h-full min-h-0 overflow-hidden rounded-[28px] border border-black/10 bg-black/90">
        <ReportsModule />
      </div>
    </main>
  );
}
