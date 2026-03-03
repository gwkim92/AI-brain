import { redirect } from "next/navigation";

import { buildHudWorkspaceHref } from "@/lib/hud/widget-presets";

export default function StudioCodePage() {
  redirect(buildHudWorkspaceHref("studio_code", undefined, "full"));
}
