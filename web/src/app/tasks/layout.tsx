import { UserShell } from "@/components/layout/product/ProductShell";

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
