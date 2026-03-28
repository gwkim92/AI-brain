import { UserShell } from "@/components/layout/product/ProductShell";

export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
