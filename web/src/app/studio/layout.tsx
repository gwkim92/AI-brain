import { AppShell } from "@/components/layout/AppShell";
import { HUDProvider } from "@/components/providers/HUDProvider";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <HUDProvider>
      <AppShell>{children}</AppShell>
    </HUDProvider>
  );
}
