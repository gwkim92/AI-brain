"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Send, Copy, Sparkles, CheckCircle2 } from "lucide-react";

import { MarkdownLite } from "@/components/ui/MarkdownLite";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { buildMissionIntake, dispatchMissionIntake } from "@/lib/hud/mission-intake";
import { inferHudIntent, resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import type { HudWorkspacePreset } from "@/lib/hud/widget-presets";
import type { AppLocale } from "@/lib/locale";
import { publishSkillPrefill } from "@/lib/skills/prefill";

type IdeationQuestionType = "pick_one" | "pick_many" | "rank" | "ask_text";

type IdeationQuestion = {
    id: string;
    title: string;
    type: IdeationQuestionType;
    options: string[];
    answerOne?: string;
    answerMany?: string[];
    answerRank?: string[];
    answerText?: string;
};

type IdeationBranch = {
    id: string;
    title: string;
    angle: string;
    questions: IdeationQuestion[];
};

type PersistedIdeationSession = {
    problem: string;
    branches: IdeationBranch[];
    updatedAt: string;
};

const IDEATION_STORAGE_KEY = "jarvis.ideation.session.v1";
type IdeationBlueprint = {
    id: "user_value" | "business_impact" | "architecture" | "go_to_market" | "governance" | "execution_plan";
    title: string;
    angle: string;
    executionModes: string[];
    risks: string[];
    metrics: string[];
};

const IDEATION_BLUEPRINTS: Record<AppLocale, IdeationBlueprint[]> = {
    ko: [
        {
            id: "user_value",
            title: "사용자 가치",
            angle: "사용자 효용과 당장 체감할 수 있는 가치",
            executionModes: ["빠른 MVP", "기능 고도화", "기존 플로우 대체"],
            risks: ["가치 전달 불명확", "온보딩 복잡도 증가", "핵심 사용 시나리오 누락"],
            metrics: ["주간 활성 사용자", "첫 성공까지 시간", "재방문율"],
        },
        {
            id: "business_impact",
            title: "비즈니스 임팩트",
            angle: "매출, 비용, 운영 효율 관점의 영향",
            executionModes: ["비용 절감형", "매출 확장형", "리스크 완화형"],
            risks: ["ROI 불확실성", "운영 부하 증가", "단기 성과 지연"],
            metrics: ["전환율", "단위 비용", "운영 이슈 건수"],
        },
        {
            id: "architecture",
            title: "아키텍처",
            angle: "기술 부채, 확장성, 장애 반경 관점",
            executionModes: ["모놀리식 확장", "도메인 분리", "비동기 파이프라인"],
            risks: ["복잡도 급증", "배포 위험 증가", "회귀 테스트 누락"],
            metrics: ["실패율", "배포 리드타임", "복구 시간"],
        },
        {
            id: "go_to_market",
            title: "Go-To-Market",
            angle: "출시 순서, 사용자 커뮤니케이션, 채택 전략",
            executionModes: ["내부 파일럿", "초기 얼리어답터", "전면 롤아웃"],
            risks: ["메시지 혼선", "채택 저조", "지원 리소스 부족"],
            metrics: ["활성화율", "코호트 잔존", "지원 티켓 비율"],
        },
        {
            id: "governance",
            title: "거버넌스",
            angle: "권한, 보안, 감사 추적, 운영 통제",
            executionModes: ["강제 정책", "권고 정책", "단계적 정책"],
            risks: ["권한 오남용", "감사 공백", "정책 우회"],
            metrics: ["승인 지연 시간", "정책 위반 건수", "감사 적합성"],
        },
        {
            id: "execution_plan",
            title: "실행 계획",
            angle: "현실적인 일정, 인력, 우선순위 관점",
            executionModes: ["2주 스프린트", "4주 안정화", "병렬 트랙"],
            risks: ["범위 확장", "의존성 지연", "리소스 부족"],
            metrics: ["완료율", "지연률", "핵심 이슈 해결 속도"],
        },
    ],
    en: [
        {
            id: "user_value",
            title: "User Value",
            angle: "Immediate user value and visible payoff",
            executionModes: ["Fast MVP", "Capability upgrade", "Replace existing flow"],
            risks: ["Weak value signal", "Onboarding complexity", "Missing core scenario"],
            metrics: ["WAU", "Time to first success", "Return rate"],
        },
        {
            id: "business_impact",
            title: "Business Impact",
            angle: "Revenue, cost, and operational efficiency impact",
            executionModes: ["Cost reduction", "Revenue expansion", "Risk mitigation"],
            risks: ["Unclear ROI", "Higher ops load", "Slow short-term payoff"],
            metrics: ["Conversion rate", "Unit cost", "Ops issue count"],
        },
        {
            id: "architecture",
            title: "Architecture",
            angle: "Technical debt, scalability, and blast radius",
            executionModes: ["Monolith extension", "Domain split", "Async pipeline"],
            risks: ["Complexity spike", "Deployment risk", "Missed regression tests"],
            metrics: ["Failure rate", "Deployment lead time", "Recovery time"],
        },
        {
            id: "go_to_market",
            title: "Go-To-Market",
            angle: "Launch sequence, user communication, and adoption strategy",
            executionModes: ["Internal pilot", "Early adopters", "Full rollout"],
            risks: ["Mixed messaging", "Low adoption", "Support gaps"],
            metrics: ["Activation rate", "Cohort retention", "Support ticket ratio"],
        },
        {
            id: "governance",
            title: "Governance",
            angle: "Permissions, security, auditability, and control",
            executionModes: ["Enforced policy", "Advisory policy", "Phased policy"],
            risks: ["Privilege misuse", "Audit gaps", "Policy bypass"],
            metrics: ["Approval latency", "Policy violation count", "Audit readiness"],
        },
        {
            id: "execution_plan",
            title: "Execution Plan",
            angle: "Realistic schedule, staffing, and prioritization",
            executionModes: ["2-week sprint", "4-week stabilization", "Parallel tracks"],
            risks: ["Scope creep", "Dependency delay", "Resource shortage"],
            metrics: ["Completion rate", "Delay rate", "Critical issue resolution speed"],
        },
    ],
};

const IDEATION_COPY: Record<
    AppLocale,
    {
        questionPrimary: string;
        questionRisk: string;
        questionMetric: string;
        questionConstraint: string;
        answerNone: string;
        answerMissingRisk: string;
        answerMissingText: string;
        synthesisTitle: string;
        synthesisProblem: string;
        synthesisProblemEmpty: string;
        synthesisScoreboard: string;
        synthesisBranch: string;
        synthesisCompletion: string;
        synthesisPrimaryBet: string;
        synthesisTopRisk: string;
        synthesisRecommendedWorkspace: string;
        synthesisSuggestedNextAction: string;
        synthesisSuggestedNextActionBody: string;
        assistantIntro: string;
        assistantGoal: string;
        assistantRequirements: string;
        assistantRequirement1: string;
        assistantRequirement2: string;
        assistantRequirement3: string;
        assistantRequirement4: string;
    }
> = {
    ko: {
        questionPrimary: "이번 브랜치에서 가장 우선할 실행 타입은?",
        questionRisk: "가장 우려되는 리스크를 복수 선택하세요.",
        questionMetric: "성공 판단 지표 우선순위를 정하세요 (상위부터 클릭).",
        questionConstraint: "이 브랜치에서 반드시 지켜야 할 제약/원칙을 서술하세요.",
        answerNone: "미선택",
        answerMissingRisk: "리스크 미입력",
        answerMissingText: "미입력",
        synthesisTitle: "Ideation Synthesis",
        synthesisProblem: "Problem",
        synthesisProblemEmpty: "문제 정의 없음",
        synthesisScoreboard: "Branch Scoreboard",
        synthesisBranch: "Branch",
        synthesisCompletion: "Completion",
        synthesisPrimaryBet: "Primary Bet",
        synthesisTopRisk: "Top Risk",
        synthesisRecommendedWorkspace: "Recommended Workspace",
        synthesisSuggestedNextAction: "Suggested Next Action",
        synthesisSuggestedNextActionBody: "선택된 우선순위를 기준으로 2주 단위 실행 계획을 만들고, 리스크 완화 항목을 승인 게이트에 연결하세요.",
        assistantIntro: "다음은 브랜치 기반 ideation 결과다.",
        assistantGoal: '목표는 "실행 가능한 제품 계획"으로 수렴하는 것이다.',
        assistantRequirements: "요구사항:",
        assistantRequirement1: "1. 2주 단위 실행 플랜을 작성한다.",
        assistantRequirement2: "2. 각 단계별 owner/입력/산출물/검증 기준을 명시한다.",
        assistantRequirement3: "3. 리스크 완화 조치와 승인 필요 지점을 표시한다.",
        assistantRequirement4: "4. 우선순위 변경 조건(트리거)을 명시한다.",
    },
    en: {
        questionPrimary: "Which execution mode should this branch prioritize first?",
        questionRisk: "Select the biggest risks for this branch.",
        questionMetric: "Rank the success metrics from highest priority downward.",
        questionConstraint: "Describe the constraints or principles this branch must preserve.",
        answerNone: "Not selected",
        answerMissingRisk: "No risk entered",
        answerMissingText: "No input",
        synthesisTitle: "Ideation Synthesis",
        synthesisProblem: "Problem",
        synthesisProblemEmpty: "No problem defined",
        synthesisScoreboard: "Branch Scoreboard",
        synthesisBranch: "Branch",
        synthesisCompletion: "Completion",
        synthesisPrimaryBet: "Primary Bet",
        synthesisTopRisk: "Top Risk",
        synthesisRecommendedWorkspace: "Recommended Workspace",
        synthesisSuggestedNextAction: "Suggested Next Action",
        synthesisSuggestedNextActionBody: "Turn the selected priorities into a 2-week execution plan and connect risk mitigation steps to approval gates.",
        assistantIntro: "Below is a branch-based ideation result.",
        assistantGoal: 'The goal is to converge on an "execution-ready product plan".',
        assistantRequirements: "Requirements:",
        assistantRequirement1: "1. Write a 2-week execution plan.",
        assistantRequirement2: "2. Specify owner, inputs, outputs, and validation criteria for each stage.",
        assistantRequirement3: "3. Mark risk mitigation steps and approval gates.",
        assistantRequirement4: "4. Define the trigger conditions that would change priority.",
    },
};

function createQuestion(branchId: string, index: number, title: string, type: IdeationQuestionType, options: string[]): IdeationQuestion {
    return {
        id: `${branchId}_q_${index}`,
        title,
        type,
        options
    };
}

function buildBranches(problem: string, branchCount: number, locale: AppLocale): IdeationBranch[] {
    const blueprints = IDEATION_BLUEPRINTS[locale];
    const copy = IDEATION_COPY[locale];
    const lower = problem.toLowerCase();
    const startsWithCodeBias = /api|oauth|model|trace|worker|retry|backend|frontend|ux|ui|코드|아키텍처|인증/u.test(lower);
    const startsWithMarketBias = /시장|매출|영업|마케팅|유저 획득|growth|gtm|pricing/u.test(lower);

    const ordered = [...blueprints].sort((left, right) => {
        if (startsWithCodeBias) {
            if (left.id === "architecture") return -1;
            if (right.id === "architecture") return 1;
        }
        if (startsWithMarketBias) {
            if (left.id === "go_to_market") return -1;
            if (right.id === "go_to_market") return 1;
        }
        return 0;
    });

    return ordered.slice(0, Math.max(2, Math.min(6, branchCount))).map((blueprint, branchIndex) => {
        const branchId = `branch_${branchIndex + 1}`;
        return {
            id: branchId,
            title: blueprint.title,
            angle: blueprint.angle,
            questions: [
                createQuestion(
                    branchId,
                    1,
                    copy.questionPrimary,
                    "pick_one",
                    blueprint.executionModes
                ),
                createQuestion(
                    branchId,
                    2,
                    copy.questionRisk,
                    "pick_many",
                    blueprint.risks
                ),
                createQuestion(
                    branchId,
                    3,
                    copy.questionMetric,
                    "rank",
                    blueprint.metrics
                ),
                createQuestion(
                    branchId,
                    4,
                    copy.questionConstraint,
                    "ask_text",
                    []
                )
            ]
        };
    });
}

function isQuestionAnswered(question: IdeationQuestion): boolean {
    if (question.type === "pick_one") return typeof question.answerOne === "string" && question.answerOne.trim().length > 0;
    if (question.type === "pick_many") return Array.isArray(question.answerMany) && question.answerMany.length > 0;
    if (question.type === "rank") return Array.isArray(question.answerRank) && question.answerRank.length > 0;
    if (question.type === "ask_text") return typeof question.answerText === "string" && question.answerText.trim().length > 0;
    return false;
}

function resolveQuestionAnswerSummary(question: IdeationQuestion, locale: AppLocale): string {
    const copy = IDEATION_COPY[locale];
    if (question.type === "pick_one") return question.answerOne?.trim() || copy.answerNone;
    if (question.type === "pick_many") return question.answerMany && question.answerMany.length > 0 ? question.answerMany.join(", ") : copy.answerNone;
    if (question.type === "rank") return question.answerRank && question.answerRank.length > 0 ? question.answerRank.join(" > ") : copy.answerNone;
    return question.answerText?.trim() || copy.answerMissingText;
}

function escapeTableCell(value: string): string {
    return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ").trim();
}

function mapPresetLabel(preset: HudWorkspacePreset): string {
    if (preset === "studio_code") return "studio_code";
    if (preset === "studio_research") return "studio_research";
    if (preset === "studio_intelligence") return "studio_intelligence";
    return "mission_control";
}

function buildIdeationSynthesis(problem: string, branches: IdeationBranch[], locale: AppLocale, recommendedPresetLabel: string): {
    markdown: string;
    assistantPrompt: string;
    recommendedPreset: HudWorkspacePreset;
} {
    const copy = IDEATION_COPY[locale];
    const intent = inferHudIntent(problem);
    const recommendedPreset = resolveWorkspaceForIntent(intent);

    const branchRows = branches.map((branch) => {
        const answered = branch.questions.filter((question) => isQuestionAnswered(question)).length;
        const score = Math.round((answered / branch.questions.length) * 100);
        const firstChoice = branch.questions.find((q) => q.type === "pick_one")?.answerOne ?? copy.answerNone;
        const topRisk = branch.questions.find((q) => q.type === "pick_many")?.answerMany?.[0] ?? copy.answerMissingRisk;
        return {
            title: branch.title,
            score,
            firstChoice,
            topRisk
        };
    });

    const keyInsights = branches.map((branch) => {
        const answers = branch.questions.map((question) => `- ${question.title}: ${resolveQuestionAnswerSummary(question, locale)}`).join("\n");
        return `### ${branch.title}\n${answers}`;
    });

    const markdown = [
        `## ${copy.synthesisTitle}`,
        ``,
        `### ${copy.synthesisProblem}`,
        `${problem.trim() || copy.synthesisProblemEmpty}`,
        ``,
        `### ${copy.synthesisScoreboard}`,
        `| ${copy.synthesisBranch} | ${copy.synthesisCompletion} | ${copy.synthesisPrimaryBet} | ${copy.synthesisTopRisk} |`,
        `|---|---:|---|---|`,
        ...branchRows.map((row) =>
            `| ${escapeTableCell(row.title)} | ${row.score}% | ${escapeTableCell(row.firstChoice)} | ${escapeTableCell(row.topRisk)} |`
        ),
        ``,
        ...keyInsights,
        ``,
        `### ${copy.synthesisRecommendedWorkspace}`,
        `- ${recommendedPresetLabel} (${recommendedPreset})`,
        ``,
        `### ${copy.synthesisSuggestedNextAction}`,
        `- ${copy.synthesisSuggestedNextActionBody}`
    ].join("\n");

    const assistantPrompt = [
        copy.assistantIntro,
        copy.assistantGoal,
        ``,
        markdown,
        ``,
        copy.assistantRequirements,
        copy.assistantRequirement1,
        copy.assistantRequirement2,
        copy.assistantRequirement3,
        copy.assistantRequirement4,
    ].join("\n");

    return { markdown, assistantPrompt, recommendedPreset };
}

function parsePersistedSession(raw: string | null): PersistedIdeationSession | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as PersistedIdeationSession;
        if (!parsed || typeof parsed.problem !== "string" || !Array.isArray(parsed.branches)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function loadInitialIdeationSession(): PersistedIdeationSession | null {
    if (typeof window === "undefined") {
        return null;
    }
    return parsePersistedSession(window.localStorage.getItem(IDEATION_STORAGE_KEY));
}

export function IdeationModule() {
    const { t, locale } = useLocale();
    const { openWidgets } = useHUD();
    const [initialSession] = useState<PersistedIdeationSession | null>(() => loadInitialIdeationSession());
    const [problem, setProblem] = useState(() => initialSession?.problem ?? "");
    const [branchCount, setBranchCount] = useState(4);
    const [branches, setBranches] = useState<IdeationBranch[]>(() => initialSession?.branches ?? []);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const payload: PersistedIdeationSession = {
            problem,
            branches,
            updatedAt: new Date().toISOString()
        };
        window.localStorage.setItem(IDEATION_STORAGE_KEY, JSON.stringify(payload));
    }, [problem, branches]);

    const completion = useMemo(() => {
        const total = branches.reduce((sum, branch) => sum + branch.questions.length, 0);
        const answered = branches.reduce(
            (sum, branch) => sum + branch.questions.filter((question) => isQuestionAnswered(question)).length,
            0
        );
        return {
            total,
            answered,
            ratio: total > 0 ? Math.round((answered / total) * 100) : 0
        };
    }, [branches]);

    const recommendedPreset = useMemo(() => resolveWorkspaceForIntent(inferHudIntent(problem)), [problem]);
    const recommendedPresetLabel = t(`ideation.preset.${mapPresetLabel(recommendedPreset)}` as never);
    const synthesis = useMemo(
        () => buildIdeationSynthesis(problem, branches, locale, recommendedPresetLabel),
        [branches, locale, problem, recommendedPresetLabel]
    );

    const resetAll = useCallback(() => {
        setProblem("");
        setBranches([]);
        setCopied(false);
        window.localStorage.removeItem(IDEATION_STORAGE_KEY);
    }, []);

    const createBranches = useCallback(() => {
        const next = buildBranches(problem, branchCount, locale);
        setBranches(next);
    }, [branchCount, locale, problem]);

    const updateQuestion = useCallback((branchId: string, questionId: string, patch: Partial<IdeationQuestion>) => {
        setBranches((prev) =>
            prev.map((branch) => {
                if (branch.id !== branchId) return branch;
                return {
                    ...branch,
                    questions: branch.questions.map((question) =>
                        question.id === questionId ? { ...question, ...patch } : question
                    )
                };
            })
        );
    }, []);

    const togglePickMany = useCallback((branchId: string, questionId: string, option: string) => {
        setBranches((prev) =>
            prev.map((branch) => {
                if (branch.id !== branchId) return branch;
                return {
                    ...branch,
                    questions: branch.questions.map((question) => {
                        if (question.id !== questionId) return question;
                        const current = new Set(question.answerMany ?? []);
                        if (current.has(option)) current.delete(option);
                        else current.add(option);
                        return {
                            ...question,
                            answerMany: Array.from(current)
                        };
                    })
                };
            })
        );
    }, []);

    const toggleRankSelection = useCallback((branchId: string, questionId: string, option: string) => {
        setBranches((prev) =>
            prev.map((branch) => {
                if (branch.id !== branchId) return branch;
                return {
                    ...branch,
                    questions: branch.questions.map((question) => {
                        if (question.id !== questionId) return question;
                        const current = [...(question.answerRank ?? [])];
                        const existingIndex = current.indexOf(option);
                        if (existingIndex >= 0) {
                            current.splice(existingIndex, 1);
                        } else {
                            current.push(option);
                        }
                        return {
                            ...question,
                            answerRank: current.slice(0, 5)
                        };
                    })
                };
            })
        );
    }, []);

    const sendToAssistant = useCallback(() => {
        const prompt = synthesis.assistantPrompt;
        const intake = buildMissionIntake(prompt, "inbox_quick_command");
        dispatchMissionIntake(intake);
        openWidgets(["ideation", "assistant", "tasks"], {
            focus: "assistant",
            replace: false,
            activate: "all"
        });
    }, [openWidgets, synthesis.assistantPrompt]);

    const copyMarkdown = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(synthesis.markdown);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            setCopied(false);
        }
    }, [synthesis.markdown]);

    const sendToSkills = useCallback(() => {
        publishSkillPrefill({
            prompt: synthesis.assistantPrompt,
        });
        openWidgets(["ideation", "skills", "assistant"], {
            focus: "skills",
            replace: false,
            activate: "all"
        });
    }, [openWidgets, synthesis.assistantPrompt]);

    return (
        <main className="h-full overflow-y-auto px-6 py-5 space-y-4 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.15),transparent_42%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.12),transparent_44%)]">
            <section className="rounded-xl border border-emerald-500/30 bg-black/35 p-4 backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-500/20 text-emerald-200">
                            <Lightbulb size={16} />
                        </span>
                        <div>
                            <p className="text-[11px] font-mono tracking-widest text-emerald-300">{t("ideation.title").toUpperCase()}</p>
                            <p className="text-xs text-white/60">{t("ideation.subtitle")}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-white/60">
                        <span className="rounded border border-white/15 bg-black/40 px-2 py-1">
                            {t("ideation.completion", { ratio: completion.ratio, answered: completion.answered, total: completion.total })}
                        </span>
                        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                            {t("ideation.recommend", { value: recommendedPresetLabel })}
                        </span>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                    <textarea
                        value={problem}
                        onChange={(event) => setProblem(event.target.value)}
                        placeholder={t("ideation.problemPlaceholder")}
                        rows={3}
                        className="w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm text-white/85 placeholder:text-white/35 focus:border-emerald-500/45 focus:outline-none"
                    />
                    <div className="flex items-end gap-2">
                        <label className="text-[11px] font-mono text-white/60">
                            {t("ideation.branches")}
                            <input
                                type="number"
                                min={2}
                                max={6}
                                value={branchCount}
                                onChange={(event) => setBranchCount(Math.max(2, Math.min(6, Number(event.target.value) || 4)))}
                                className="mt-1 block w-20 rounded border border-white/15 bg-black/50 px-2 py-1 text-xs text-white/80"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={createBranches}
                            disabled={problem.trim().length < 8}
                            className="rounded border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-[11px] font-mono tracking-widest text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                        >
                            {t("ideation.buildBranches")}
                        </button>
                        <button
                            type="button"
                            onClick={resetAll}
                            className="rounded border border-white/20 bg-black/40 px-3 py-2 text-[11px] font-mono tracking-widest text-white/70 hover:text-white"
                        >
                            {t("common.reset")}
                        </button>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3">
                    {branches.length === 0 && (
                        <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/60">
                            {t("ideation.emptyLead")} <span className="font-mono text-emerald-300">{t("ideation.buildBranches").toUpperCase()}</span>
                            {` ${t("ideation.empty")}`}
                        </div>
                    )}
                    {branches.map((branch) => {
                        const answered = branch.questions.filter((question) => isQuestionAnswered(question)).length;
                        return (
                            <article key={branch.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">{branch.title}</p>
                                        <p className="mt-1 text-xs text-white/65">{branch.angle}</p>
                                    </div>
                                    <span className="rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] font-mono text-white/60">
                                        {answered}/{branch.questions.length}
                                    </span>
                                </div>

                                <div className="mt-3 space-y-3">
                                    {branch.questions.map((question) => (
                                        <div key={question.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                                            <p className="text-xs text-white/80">{question.title}</p>
                                            {question.type === "pick_one" && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {question.options.map((option) => {
                                                        const active = question.answerOne === option;
                                                        return (
                                                            <button
                                                                key={`${question.id}_${option}`}
                                                                type="button"
                                                                onClick={() =>
                                                                    updateQuestion(branch.id, question.id, {
                                                                        answerOne: option
                                                                    })
                                                                }
                                                                className={`rounded border px-2 py-1 text-[11px] ${
                                                                    active
                                                                        ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-200"
                                                                        : "border-white/20 bg-black/40 text-white/70"
                                                                }`}
                                                            >
                                                                {option}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {question.type === "pick_many" && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {question.options.map((option) => {
                                                        const active = (question.answerMany ?? []).includes(option);
                                                        return (
                                                            <button
                                                                key={`${question.id}_${option}`}
                                                                type="button"
                                                                onClick={() => togglePickMany(branch.id, question.id, option)}
                                                                className={`rounded border px-2 py-1 text-[11px] ${
                                                                    active
                                                                        ? "border-cyan-400/60 bg-cyan-500/25 text-cyan-100"
                                                                        : "border-white/20 bg-black/40 text-white/70"
                                                                }`}
                                                            >
                                                                {option}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {question.type === "rank" && (
                                                <div className="mt-2 space-y-2">
                                                    <div className="flex flex-wrap gap-2">
                                                        {question.options.map((option) => {
                                                            const rank = (question.answerRank ?? []).indexOf(option);
                                                            return (
                                                                <button
                                                                    key={`${question.id}_${option}`}
                                                                    type="button"
                                                                    onClick={() => toggleRankSelection(branch.id, question.id, option)}
                                                                    className={`rounded border px-2 py-1 text-[11px] ${
                                                                        rank >= 0
                                                                            ? "border-fuchsia-400/70 bg-fuchsia-500/25 text-fuchsia-100"
                                                                            : "border-white/20 bg-black/40 text-white/70"
                                                                    }`}
                                                                >
                                                                    {rank >= 0 ? `${rank + 1}. ` : ""}{option}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {question.answerRank && question.answerRank.length > 0 && (
                                                        <p className="text-[11px] text-white/60">
                                                            {t("ideation.rankLabel")}: {question.answerRank.join(" > ")}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                            {question.type === "ask_text" && (
                                                <textarea
                                                    rows={2}
                                                    value={question.answerText ?? ""}
                                                    onChange={(event) =>
                                                        updateQuestion(branch.id, question.id, {
                                                            answerText: event.target.value
                                                        })
                                                    }
                                                    placeholder={t("ideation.textPlaceholder")}
                                                    className="mt-2 w-full rounded border border-white/15 bg-black/45 px-2 py-1.5 text-xs text-white/80 placeholder:text-white/35"
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </article>
                        );
                    })}
                </div>

                <aside className="space-y-3">
                    <div className="rounded-xl border border-cyan-500/25 bg-black/35 p-4">
                            <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("ideation.synthesisPreview")}</p>
                        <div className="mt-3 max-h-[34rem] overflow-y-auto pr-1 text-sm">
                            <MarkdownLite content={synthesis.markdown} className="space-y-3 text-white/80" />
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-2">
                        <button
                            type="button"
                            onClick={sendToAssistant}
                            disabled={branches.length === 0}
                            className="flex w-full items-center justify-center gap-2 rounded border border-emerald-500/45 bg-emerald-500/20 px-3 py-2 text-[11px] font-mono tracking-widest text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                        >
                            <Send size={13} />
                            {t("ideation.sendToAssistant")}
                        </button>
                        <button
                            type="button"
                            onClick={copyMarkdown}
                            disabled={branches.length === 0}
                            className="flex w-full items-center justify-center gap-2 rounded border border-white/20 bg-black/45 px-3 py-2 text-[11px] font-mono tracking-widest text-white/75 hover:text-white disabled:opacity-40"
                        >
                            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                            {copied ? t("ideation.copied") : t("ideation.copyMarkdown")}
                        </button>
                        <button
                            type="button"
                            onClick={sendToSkills}
                            disabled={branches.length === 0}
                            className="flex w-full items-center justify-center gap-2 rounded border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-[11px] font-mono tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
                        >
                            <Sparkles size={13} />
                            {t("ideation.sendToSkills")}
                        </button>
                        <p className="pt-1 text-[11px] text-white/55">
                            {t("ideation.assistantHint")}
                        </p>
                    </div>

                    <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4 text-[11px] text-fuchsia-100/85">
                        <p className="font-mono tracking-widest text-fuchsia-200">{t("ideation.patternNotes")}</p>
                        <ul className="mt-2 space-y-1 text-white/75">
                            <li>- {t("ideation.note.octto")}</li>
                            <li>- {t("ideation.note.micode")}</li>
                            <li>- {t("ideation.note.ohMyOpenCode")}</li>
                            <li>- {t("ideation.note.mdTableFormatter")}</li>
                        </ul>
                        <div className="mt-2 inline-flex items-center gap-1 rounded border border-fuchsia-400/30 px-2 py-1 text-[10px] font-mono tracking-widest text-fuchsia-200">
                            <Sparkles size={12} />
                            {t("ideation.uxTrackEnabled")}
                        </div>
                    </div>
                </aside>
            </section>
        </main>
    );
}
