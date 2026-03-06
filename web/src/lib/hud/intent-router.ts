import { isFeatureEnabled } from "@/lib/feature-flags";

export type HudWidgetId =
  | "inbox"
  | "assistant"
  | "tasks"
  | "council"
  | "workbench"
  | "reports"
  | "watchers"
  | "dossier"
  | "action_center"
  | "notifications"
  | "skills"
  | "approvals"
  | "memory"
  | "settings"
  | "model_control"
  | "ideation";

export type HudIntent = "code" | "research" | "finance" | "news" | "council" | "general";
export type HudTaskMode = "code" | "execute" | "radar_review" | "council";

const CODE_KEYWORDS =
  /(코드|개발|버그|디버그|리팩토링|테스트|패치|api 설계|architecture|code|debug|refactor|test|fix)/i;
const COUNCIL_KEYWORDS =
  /(agent\s*council|에이전트\s*카운슬|agent council로|council로 보내|카운슬로 보내|debate|토론하고 최종 결론|찬성[\\/· ,]+반대|찬반|반대 관점|리스크 관점)/i;
const OPS_KEYWORDS =
  /(로그인|429|rate limit|에러|오류|장애|원인|수정|디버깅|실패|서비스|incident|outage|auth)/i;
const RESEARCH_KEYWORDS = /(리서치|연구|논문|근거|인용|가설|조사|research|study)/i;
const FINANCE_KEYWORDS = /(금융|주식|환율|거시|포트폴리오|리스크|재무|finance|market|asset)/i;
const NEWS_KEYWORDS = /(뉴스|정치|경제 브리핑|속보|이슈|뉴스레터|news|briefing)/i;
const HIGH_RISK_KEYWORDS = /(승인|approve|결제|payment|환불|refund|권한|보안|security|법적|legal)/i;
const IDEATION_KEYWORDS = /(브레인스토밍|아이디어|기획|전략|탐색|가설|우선순위|brainstorm|ideation|strategy|discovery)/i;

export function inferHudIntent(prompt: string): HudIntent {
  if (COUNCIL_KEYWORDS.test(prompt)) {
    return "council";
  }
  if (CODE_KEYWORDS.test(prompt)) {
    return "code";
  }
  const opsBiasEnabled = isFeatureEnabled("hud.intent_router_ops_bias_v1", true);
  if (opsBiasEnabled && OPS_KEYWORDS.test(prompt)) {
    return "general";
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
  if (intent === "council") {
    return "council";
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
  } else if (intent === "council") {
    base.splice(1, 0, "council", "notifications");
  } else if (intent === "research") {
    base.splice(1, 0, "dossier", "watchers", "notifications");
  } else if (intent === "finance" || intent === "news") {
    base.splice(1, 0, "dossier", "watchers", "notifications");
  }

  if (HIGH_RISK_KEYWORDS.test(prompt)) {
    base.push("action_center", "approvals", "notifications");
  }

  if (IDEATION_KEYWORDS.test(prompt)) {
    base.splice(1, 0, "ideation", "skills");
  }

  return Array.from(new Set(base));
}

export type IntentWorkspacePreset = "mission" | "studio_code" | "studio_research" | "studio_intelligence" | "studio_council";

const INTENT_TO_WORKSPACE: Record<HudIntent, IntentWorkspacePreset> = {
  code: "studio_code",
  research: "studio_research",
  finance: "studio_intelligence",
  news: "studio_intelligence",
  council: "studio_council",
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
