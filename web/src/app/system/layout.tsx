import { SystemShell } from "@/components/layout/product/ProductShell";

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return <SystemShell>{children}</SystemShell>;
}
