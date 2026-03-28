import { redirect } from "next/navigation";

import { UserShell } from "@/components/layout/product/ProductShell";
import { UserHomePage } from "@/components/pages/UserHomePage";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const LEGACY_STUDIO_PARAMS = new Set([
  "widget",
  "widgets",
  "focus",
  "replace",
  "activation",
  "dossier",
  "watcher_title",
  "watcher_query",
  "watcher_kind",
]);

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolved = await searchParams;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(resolved)) {
    const normalized = first(value);
    if (normalized) {
      params.set(key, normalized);
    }
  }

  const shouldRedirectToStudio = Array.from(LEGACY_STUDIO_PARAMS).some((key) => params.has(key));
  if (shouldRedirectToStudio) {
    redirect(params.toString().length > 0 ? `/studio?${params.toString()}` : "/studio");
  }

  return (
    <UserShell>
      <UserHomePage />
    </UserShell>
  );
}
