import type { HudWidgetId } from "@/lib/hud/intent-router";

export type HudWorkspacePreset =
  | "mission"
  | "studio_code"
  | "studio_research"
  | "studio_intelligence"
  | "studio_council";

type HudWorkspacePresetConfig = {
  primary: HudWidgetId;
  widgets: HudWidgetId[];
  focus: HudWidgetId;
};

export const HUD_WORKSPACE_PRESETS: Record<HudWorkspacePreset, HudWorkspacePresetConfig> = {
  mission: {
    primary: "assistant",
    widgets: ["inbox", "assistant", "tasks", "action_center", "notifications", "skills"],
    focus: "assistant",
  },
  studio_code: {
    primary: "workbench",
    widgets: ["assistant", "tasks", "workbench", "skills", "action_center", "notifications"],
    focus: "workbench",
  },
  studio_research: {
    primary: "watchers",
    widgets: ["watchers", "dossier", "assistant", "notifications"],
    focus: "watchers",
  },
  studio_intelligence: {
    primary: "reports",
    widgets: ["reports", "action_center", "notifications", "model_control", "skills", "tasks"],
    focus: "reports",
  },
  studio_council: {
    primary: "council",
    widgets: ["assistant", "council", "tasks", "notifications", "model_control"],
    focus: "council",
  },
};

export function getHudWorkspacePrimaryWidget(preset: HudWorkspacePreset): HudWidgetId {
  return HUD_WORKSPACE_PRESETS[preset].primary;
}

export function getHudWorkspacePresetConfig(preset: HudWorkspacePreset): HudWorkspacePresetConfig {
  return HUD_WORKSPACE_PRESETS[preset];
}

export function buildHudWorkspaceHref(
  preset: HudWorkspacePreset,
  extras?: Record<string, string | undefined>,
  mode: "primary" | "full" = "primary"
): string {
  const params = new URLSearchParams();
  const config = HUD_WORKSPACE_PRESETS[preset];

  if (mode === "full") {
    params.set("widgets", config.widgets.join(","));
    params.set("focus", config.focus);
    params.set("replace", "1");
    params.set("activation", "all");
  } else {
    params.set("widget", config.primary);
  }

  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (typeof value === "string" && value.trim().length > 0) {
        params.set(key, value);
      }
    }
  }

  return `/?${params.toString()}`;
}
