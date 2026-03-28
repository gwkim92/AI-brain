import { UserShell } from "@/components/layout/product/ProductShell";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
