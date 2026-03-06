"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Send, Copy, Sparkles, CheckCircle2 } from "lucide-react";

import { MarkdownLite } from "@/components/ui/MarkdownLite";
import { useHUD } from "@/components/providers/HUDProvider";
import { buildMissionIntake, dispatchMissionIntake } from "@/lib/hud/mission-intake";
import { inferHudIntent, resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import type { HudWorkspacePreset } from "@/lib/hud/widget-presets";
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

const BRANCH_BLUEPRINTS: Array<{ title: string; angle: string; executionModes: string[]; risks: string[]; metrics: string[] }> = [
    {
        title: "User Value",
        angle: "사용자 효용과 당장 체감할 수 있는 가치",
        executionModes: ["빠른 MVP", "기능 고도화", "기존 플로우 대체"],
        risks: ["가치 전달 불명확", "온보딩 복잡도 증가", "핵심 사용 시나리오 누락"],
        metrics: ["주간 활성 사용자", "첫 성공까지 시간", "재방문율"]
    },
    {
        title: "Business Impact",
        angle: "매출/비용/운영 효율 관점의 영향",
        executionModes: ["비용 절감형", "매출 확장형", "리스크 완화형"],
        risks: ["ROI 불확실성", "운영 부하 증가", "단기 성과 지연"],
        metrics: ["전환율", "단위 비용", "운영 이슈 건수"]
    },
    {
        title: "Architecture",
        angle: "기술 부채, 확장성, 장애 반경 관점",
        executionModes: ["모놀리식 확장", "도메인 분리", "비동기 파이프라인"],
        risks: ["복잡도 급증", "배포 위험 증가", "회귀 테스트 누락"],
        metrics: ["실패율", "배포 리드타임", "복구 시간"]
    },
    {
        title: "Go-To-Market",
        angle: "출시 순서, 사용자 커뮤니케이션, 채택 전략",
        executionModes: ["내부 파일럿", "초기 얼리어답터", "전면 롤아웃"],
        risks: ["메시지 혼선", "채택 저조", "지원 리소스 부족"],
        metrics: ["활성화율", "코호트 잔존", "지원 티켓 비율"]
    },
    {
        title: "Governance",
        angle: "권한, 보안, 감사 추적, 운영 통제",
        executionModes: ["강제 정책", "권고 정책", "단계적 정책"],
        risks: ["권한 오남용", "감사 공백", "정책 우회"],
        metrics: ["승인 지연 시간", "정책 위반 건수", "감사 적합성"]
    },
    {
        title: "Execution Plan",
        angle: "현실적인 일정/인력/우선순위 관점",
        executionModes: ["2주 스프린트", "4주 안정화", "병렬 트랙"],
        risks: ["범위 확장", "의존성 지연", "리소스 부족"],
        metrics: ["완료율", "지연률", "핵심 이슈 해결 속도"]
    }
];

function createQuestion(branchId: string, index: number, title: string, type: IdeationQuestionType, options: string[]): IdeationQuestion {
    return {
        id: `${branchId}_q_${index}`,
        title,
        type,
        options
    };
}

function buildBranches(problem: string, branchCount: number): IdeationBranch[] {
    const lower = problem.toLowerCase();
    const startsWithCodeBias = /api|oauth|model|trace|worker|retry|backend|frontend|ux|ui|코드|아키텍처|인증/u.test(lower);
    const startsWithMarketBias = /시장|매출|영업|마케팅|유저 획득|growth|gtm|pricing/u.test(lower);

    const ordered = [...BRANCH_BLUEPRINTS].sort((left, right) => {
        if (startsWithCodeBias) {
            if (left.title === "Architecture") return -1;
            if (right.title === "Architecture") return 1;
        }
        if (startsWithMarketBias) {
            if (left.title === "Go-To-Market") return -1;
            if (right.title === "Go-To-Market") return 1;
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
                    "이번 브랜치에서 가장 우선할 실행 타입은?",
                    "pick_one",
                    blueprint.executionModes
                ),
                createQuestion(
                    branchId,
                    2,
                    "가장 우려되는 리스크를 복수 선택하세요.",
                    "pick_many",
                    blueprint.risks
                ),
                createQuestion(
                    branchId,
                    3,
                    "성공 판단 지표 우선순위를 정하세요 (상위부터 클릭).",
                    "rank",
                    blueprint.metrics
                ),
                createQuestion(
                    branchId,
                    4,
                    "이 브랜치에서 반드시 지켜야 할 제약/원칙을 서술하세요.",
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

function resolveQuestionAnswerSummary(question: IdeationQuestion): string {
    if (question.type === "pick_one") return question.answerOne?.trim() || "미선택";
    if (question.type === "pick_many") return question.answerMany && question.answerMany.length > 0 ? question.answerMany.join(", ") : "미선택";
    if (question.type === "rank") return question.answerRank && question.answerRank.length > 0 ? question.answerRank.join(" > ") : "미선택";
    return question.answerText?.trim() || "미입력";
}

function escapeTableCell(value: string): string {
    return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ").trim();
}

function mapPresetLabel(preset: HudWorkspacePreset): string {
    if (preset === "studio_code") return "Code Studio";
    if (preset === "studio_research") return "Research Studio";
    if (preset === "studio_intelligence") return "Intelligence Studio";
    return "Mission Control";
}

function buildIdeationSynthesis(problem: string, branches: IdeationBranch[]): {
    markdown: string;
    assistantPrompt: string;
    recommendedPreset: HudWorkspacePreset;
} {
    const intent = inferHudIntent(problem);
    const recommendedPreset = resolveWorkspaceForIntent(intent);

    const branchRows = branches.map((branch) => {
        const answered = branch.questions.filter((question) => isQuestionAnswered(question)).length;
        const score = Math.round((answered / branch.questions.length) * 100);
        const firstChoice = branch.questions.find((q) => q.type === "pick_one")?.answerOne ?? "미선택";
        const topRisk = branch.questions.find((q) => q.type === "pick_many")?.answerMany?.[0] ?? "리스크 미입력";
        return {
            title: branch.title,
            score,
            firstChoice,
            topRisk
        };
    });

    const keyInsights = branches.map((branch) => {
        const answers = branch.questions.map((question) => `- ${question.title}: ${resolveQuestionAnswerSummary(question)}`).join("\n");
        return `### ${branch.title}\n${answers}`;
    });

    const markdown = [
        `## Ideation Synthesis`,
        ``,
        `### Problem`,
        `${problem.trim() || "문제 정의 없음"}`,
        ``,
        `### Branch Scoreboard`,
        `| Branch | Completion | Primary Bet | Top Risk |`,
        `|---|---:|---|---|`,
        ...branchRows.map((row) =>
            `| ${escapeTableCell(row.title)} | ${row.score}% | ${escapeTableCell(row.firstChoice)} | ${escapeTableCell(row.topRisk)} |`
        ),
        ``,
        ...keyInsights,
        ``,
        `### Recommended Workspace`,
        `- ${mapPresetLabel(recommendedPreset)} (${recommendedPreset})`,
        ``,
        `### Suggested Next Action`,
        `- 선택된 우선순위를 기준으로 2주 단위 실행 계획을 만들고, 리스크 완화 항목을 승인 게이트에 연결하세요.`
    ].join("\n");

    const assistantPrompt = [
        `다음은 브랜치 기반 ideation 결과다.`,
        `목표는 "실행 가능한 제품 계획"으로 수렴하는 것이다.`,
        ``,
        markdown,
        ``,
        `요구사항:`,
        `1. 2주 단위 실행 플랜을 작성한다.`,
        `2. 각 단계별 owner/입력/산출물/검증 기준을 명시한다.`,
        `3. 리스크 완화 조치와 승인 필요 지점을 표시한다.`,
        `4. 우선순위 변경 조건(트리거)을 명시한다.`
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

    const synthesis = useMemo(() => buildIdeationSynthesis(problem, branches), [problem, branches]);

    const resetAll = useCallback(() => {
        setProblem("");
        setBranches([]);
        setCopied(false);
        window.localStorage.removeItem(IDEATION_STORAGE_KEY);
    }, []);

    const createBranches = useCallback(() => {
        const next = buildBranches(problem, branchCount);
        setBranches(next);
    }, [branchCount, problem]);

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
                            <p className="text-[11px] font-mono tracking-widest text-emerald-300">IDEATION LAB</p>
                            <p className="text-xs text-white/60">Branch-driven exploration for product and execution strategy</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-white/60">
                        <span className="rounded border border-white/15 bg-black/40 px-2 py-1">
                            Completion {completion.ratio}% ({completion.answered}/{completion.total})
                        </span>
                        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                            Recommend {mapPresetLabel(synthesis.recommendedPreset)}
                        </span>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                    <textarea
                        value={problem}
                        onChange={(event) => setProblem(event.target.value)}
                        placeholder="탐색할 문제를 입력하세요. 예: 멀티 Provider 인증 + 모델 제어 UX를 유저 친화적으로 재설계하고 싶다."
                        rows={3}
                        className="w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm text-white/85 placeholder:text-white/35 focus:border-emerald-500/45 focus:outline-none"
                    />
                    <div className="flex items-end gap-2">
                        <label className="text-[11px] font-mono text-white/60">
                            Branches
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
                            BUILD BRANCHES
                        </button>
                        <button
                            type="button"
                            onClick={resetAll}
                            className="rounded border border-white/20 bg-black/40 px-3 py-2 text-[11px] font-mono tracking-widest text-white/70 hover:text-white"
                        >
                            RESET
                        </button>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3">
                    {branches.length === 0 && (
                        <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/60">
                            문제를 입력하고 <span className="font-mono text-emerald-300">BUILD BRANCHES</span>를 누르면
                            `pick_one / pick_many / rank / ask_text` 질문 세트가 생성됩니다.
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
                                                            Rank: {question.answerRank.join(" > ")}
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
                                                    placeholder="핵심 제약/원칙을 입력하세요."
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
                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">SYNTHESIS PREVIEW</p>
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
                            SEND TO ASSISTANT
                        </button>
                        <button
                            type="button"
                            onClick={copyMarkdown}
                            disabled={branches.length === 0}
                            className="flex w-full items-center justify-center gap-2 rounded border border-white/20 bg-black/45 px-3 py-2 text-[11px] font-mono tracking-widest text-white/75 hover:text-white disabled:opacity-40"
                        >
                            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                            {copied ? "COPIED" : "COPY MARKDOWN"}
                        </button>
                        <button
                            type="button"
                            onClick={sendToSkills}
                            disabled={branches.length === 0}
                            className="flex w-full items-center justify-center gap-2 rounded border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-[11px] font-mono tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
                        >
                            <Sparkles size={13} />
                            SEND TO SKILLS
                        </button>
                        <p className="pt-1 text-[11px] text-white/55">
                            Branch exploration 결과를 Assistant 또는 Skills 실행 프롬프트로 전환합니다.
                        </p>
                    </div>

                    <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4 text-[11px] text-fuchsia-100/85">
                        <p className="font-mono tracking-widest text-fuchsia-200">PATTERN NOTES</p>
                        <ul className="mt-2 space-y-1 text-white/75">
                            <li>- Octto: branch-based interactive questioning</li>
                            <li>- Micode: continuity persistence + synthesis handoff</li>
                            <li>- Oh My OpenCode: workflow template to execution prompt</li>
                            <li>- MD Table Formatter: structured table output normalization</li>
                        </ul>
                        <div className="mt-2 inline-flex items-center gap-1 rounded border border-fuchsia-400/30 px-2 py-1 text-[10px] font-mono tracking-widest text-fuchsia-200">
                            <Sparkles size={12} />
                            UX TRACK ENABLED
                        </div>
                    </div>
                </aside>
            </section>
        </main>
    );
}
