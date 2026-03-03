import { redirect } from "next/navigation";

import { buildHudWorkspaceHref } from "@/lib/hud/widget-presets";

export default function StudioResearchPage() {
  redirect(buildHudWorkspaceHref("studio_research", undefined, "full"));
}
