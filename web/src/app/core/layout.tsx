import { HUDProvider } from "@/components/providers/HUDProvider";

export default function CoreLayout({ children }: { children: React.ReactNode }) {
  return <HUDProvider>{children}</HUDProvider>;
}
