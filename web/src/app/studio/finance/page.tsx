import { redirect } from "next/navigation";

import { buildHudWorkspaceHref } from "@/lib/hud/widget-presets";

export default function StudioFinancePage() {
  redirect(buildHudWorkspaceHref("studio_intelligence", undefined, "full"));
}
