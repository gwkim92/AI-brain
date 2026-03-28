import { redirect } from "next/navigation";

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
  const params = new URLSearchParams();

  if (mission) {
    params.set("mission", mission);
  }
  if (step) {
    params.set("step", step);
  }

  redirect(params.toString().length > 0 ? `/tasks?${params.toString()}` : "/tasks");
}
