import { UserShell } from "@/components/layout/product/ProductShell";

export default function MissionLayout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
