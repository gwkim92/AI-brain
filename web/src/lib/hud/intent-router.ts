export type HudWidgetId =
  | "inbox"
  | "assistant"
  | "tasks"
  | "council"
  | "workbench"
  | "reports"
  | "approvals"
  | "memory"
  | "settings";

export type HudIntent = "code" | "research" | "finance" | "news" | "general";
export type HudTaskMode = "code" | "execute" | "radar_review";

const CODE_KEYWORDS =
  /(코드|개발|버그|디버그|리팩토링|테스트|패치|api 설계|architecture|code|debug|refactor|test|fix)/i;
const RESEARCH_KEYWORDS = /(리서치|연구|논문|근거|인용|가설|조사|research|study)/i;
const FINANCE_KEYWORDS = /(금융|주식|환율|거시|포트폴리오|리스크|재무|finance|market|asset)/i;
const NEWS_KEYWORDS = /(뉴스|정치|경제 브리핑|속보|이슈|뉴스레터|news|briefing)/i;
const HIGH_RISK_KEYWORDS = /(승인|approve|결제|payment|환불|refund|권한|보안|security|법적|legal)/i;

export function inferHudIntent(prompt: string): HudIntent {
  if (CODE_KEYWORDS.test(prompt)) {
    return "code";
  }
  if (RESEARCH_KEYWORDS.test(prompt)) {
    return "research";
  }
  if (FINANCE_KEYWORDS.test(prompt)) {
    return "finance";
  }
  if (NEWS_KEYWORDS.test(prompt)) {
    return "news";
  }
  return "general";
}

export function resolveTaskModeForIntent(intent: HudIntent): HudTaskMode {
  if (intent === "code") {
    return "code";
  }
  if (intent === "finance" || intent === "news" || intent === "research") {
    return "radar_review";
  }
  return "execute";
}

export function buildWidgetPlan(intent: HudIntent, prompt: string): HudWidgetId[] {
  const base: HudWidgetId[] = ["assistant", "tasks"];

  if (intent === "code") {
    base.splice(1, 0, "workbench");
  } else if (intent === "research") {
    base.splice(1, 0, "council");
  } else if (intent === "finance" || intent === "news") {
    base.splice(1, 0, "reports");
  }

  if (HIGH_RISK_KEYWORDS.test(prompt)) {
    base.push("approvals");
  }

  return Array.from(new Set(base));
}

export type IntentWorkspacePreset = "mission" | "studio_code" | "studio_research" | "studio_intelligence";

const INTENT_TO_WORKSPACE: Record<HudIntent, IntentWorkspacePreset> = {
  code: "studio_code",
  research: "studio_research",
  finance: "studio_intelligence",
  news: "studio_intelligence",
  general: "mission",
};

export function resolveWorkspaceForIntent(intent: HudIntent): IntentWorkspacePreset {
  return INTENT_TO_WORKSPACE[intent];
}

export type MissionStepPatternForRouting =
  | "llm_generate"
  | "council_debate"
  | "human_gate"
  | "tool_call"
  | "sub_mission";

export function resolveWorkspaceForStepPattern(
  pattern: MissionStepPatternForRouting,
  taskType?: string
): IntentWorkspacePreset {
  switch (pattern) {
    case "council_debate":
      return "studio_research";

    case "llm_generate": {
      if (taskType === "code") return "studio_code";
      if (taskType === "radar_review" || taskType === "compute") return "studio_intelligence";
      return "mission";
    }

    case "human_gate":
      return "mission";

    case "tool_call":
      return taskType === "code" ? "studio_code" : "mission";

    case "sub_mission":
      return "mission";

    default:
      return "mission";
  }
}
