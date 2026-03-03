import { redirect } from "next/navigation";

import { buildHudWorkspaceHref } from "@/lib/hud/widget-presets";

type MissionPageProps = {
  searchParams: Promise<{
    mission?: string | string[];
    step?: string | string[];
  }>;
};

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function MissionPage({ searchParams }: MissionPageProps) {
  const resolvedSearchParams = await searchParams;
  const mission = pickFirst(resolvedSearchParams.mission);
  const step = pickFirst(resolvedSearchParams.step);

  redirect(
    buildHudWorkspaceHref("mission", {
      mission,
      step,
    }, "full")
  );
}
