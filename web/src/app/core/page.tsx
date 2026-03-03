"use client";

import { Jarvis3DCore } from "@/components/ui/Jarvis3DCore";
import { useHUD } from "@/components/providers/HUDProvider";

export default function CorePage() {
  const { visualCoreScene } = useHUD();

  return (
    <main className="w-full h-full min-h-screen relative overflow-hidden bg-black">
      <div className="absolute inset-0">
        <Jarvis3DCore
          hideUI
          baseMode={visualCoreScene?.baseMode ?? "default"}
          overlayFx={visualCoreScene?.overlayFx ?? []}
          highVisibility
        />
      </div>
    </main>
  );
}
