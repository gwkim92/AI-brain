"use client";

import React, { startTransition, useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  GitBranch,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Waypoints,
  XCircle,
} from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  createV2HyperAgentEval,
  createV2HyperAgentRecommendation,
  createV2HyperAgentWorldModelSnapshot,
  createV2HyperAgentWorldModelVariant,
  applyV2HyperAgentRecommendation,
  decideV2HyperAgentRecommendation,
  getV2HyperAgentLineage,
  listV2HyperAgentArtifacts,
  listV2HyperAgentOverview,
  listV2HyperAgentWorldModelFixtures,
} from "@/lib/api/endpoints";
import type {
  HyperAgentArtifactKey,
  HyperAgentArtifactDiffEntry,
  HyperAgentArtifactsData,
  HyperAgentFixtureSetSummary,
  HyperAgentLineageData,
  HyperAgentOverviewData,
  HyperAgentOverviewRun,
  HyperAgentRecommendationRecord,
  HyperAgentRecommendationStatus,
} from "@/lib/api/types";
import { useLocale } from "@/components/providers/LocaleProvider";
import { AsyncState } from "@/components/ui/AsyncState";

type StatusFilter = "all" | HyperAgentRecommendationStatus;

const STATUS_FILTERS: StatusFilter[] = ["all", "proposed", "accepted", "applied", "rejected"];

type WorldModelEvalMetricsView = {
  primaryThesisCoverage: number;
  counterHypothesisRetained: number;
  invalidationConditionCoverage: number;
  bottleneckCoverage: number;
  watchSignalDiscipline: number;
  averageCaseScore: number;
  promotionScore: number;
};

type WorldModelCaseResultView = {
  fixtureId: string;
  passed: boolean;
  score: number;
  details: {
    checks: Array<{
      key: string;
      passed: boolean;
      expected: unknown;
      actual: unknown;
    }>;
  };
};

type HyperAgentReviewPacket = {
  version: "hyperagent_review_packet.v1";
  generatedAt: string;
  artifact: {
    key: HyperAgentArtifactKey;
    label: string;
    description: string | null;
    mutableFields: string[];
  } | null;
  fixture_set: HyperAgentFixtureSetSummary | null;
  recommendation: HyperAgentRecommendationRecord;
  promotion_score: number | null;
  gate: HyperAgentOverviewRun["gate"];
  diff: HyperAgentOverviewRun["diff"];
  snapshot: HyperAgentOverviewRun["snapshot"];
  variant: HyperAgentOverviewRun["variant"];
  eval_run: HyperAgentOverviewRun["eval_run"];
  case_results: WorldModelCaseResultView[];
  operator_note: string | null;
  applied_override: HyperAgentOverviewRun["applied_override"];
  runtime_applied: boolean;
  lineage_run_id: string | null;
  lineage: HyperAgentLineageData | null;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function formatArtifactLabel(artifactKey: string, locale: "ko" | "en"): string {
  if (artifactKey === "world_model_dossier_config") {
    return locale === "ko" ? "World Model Dossier Config" : "World Model Dossier Config";
  }
  if (artifactKey === "radar_domain_pack") {
    return locale === "ko" ? "Radar Domain Pack" : "Radar Domain Pack";
  }
  return artifactKey;
}

function formatStatusLabel(status: HyperAgentRecommendationStatus | StatusFilter, locale: "ko" | "en"): string {
  if (status === "all") return locale === "ko" ? "전체" : "All";
  if (status === "proposed") return locale === "ko" ? "제안됨" : "Proposed";
  if (status === "accepted") return locale === "ko" ? "수락됨" : "Accepted";
  if (status === "applied") return locale === "ko" ? "적용됨" : "Applied";
  return locale === "ko" ? "거절됨" : "Rejected";
}

function formatStatusTone(status: HyperAgentRecommendationStatus): string {
  if (status === "applied") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "accepted") return "border-sky-300 bg-sky-50 text-sky-700";
  if (status === "proposed") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

function summarizeValue(value: unknown): string {
  if (typeof value === "undefined") return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 96 ? `${value.slice(0, 96)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 96 ? `${serialized.slice(0, 96)}…` : serialized;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "run";
}

function downloadJsonFile(filename: string, value: unknown): void {
  const blob = new Blob([stringifyJson(value)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function resolvePromotionScore(run: HyperAgentOverviewRun): number | null {
  const recommendationScore = run.recommendation.summary.promotionScore;
  if (typeof recommendationScore === "number" && Number.isFinite(recommendationScore)) {
    return recommendationScore;
  }
  const recommendationMetrics = run.recommendation.summary.metrics;
  if (
    recommendationMetrics &&
    typeof recommendationMetrics === "object" &&
    typeof (recommendationMetrics as Record<string, unknown>).promotionScore === "number"
  ) {
    return (recommendationMetrics as Record<string, number>).promotionScore;
  }
  const evalScore = run.eval_run?.summary.promotionScore;
  if (typeof evalScore === "number" && Number.isFinite(evalScore)) {
    return evalScore;
  }
  return null;
}

function formatPromotionScore(run: HyperAgentOverviewRun): string {
  const score = resolvePromotionScore(run);
  return typeof score === "number" ? score.toFixed(3) : "n/a";
}

function formatTimestamp(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) {
    return locale === "ko" ? "기록 없음" : "No record";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatGateReason(reason: string, locale: "ko" | "en"): string {
  if (reason === "hyperagent_recommendation_not_accepted") {
    return locale === "ko" ? "먼저 recommendation을 accept 해야 한다." : "Recommendation must be accepted before apply.";
  }
  if (reason === "hyperagent_promotion_score_missing") {
    return locale === "ko" ? "promotion score가 없다." : "Promotion score is missing.";
  }
  if (reason === "hyperagent_promotion_score_below_threshold") {
    return locale === "ko" ? "promotion score가 apply threshold보다 낮다." : "Promotion score is below the apply threshold.";
  }
  return reason;
}

function isWorldModelEvalMetricsView(value: unknown): value is WorldModelEvalMetricsView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const metrics = value as Record<string, unknown>;
  return (
    typeof metrics.primaryThesisCoverage === "number" &&
    typeof metrics.counterHypothesisRetained === "number" &&
    typeof metrics.invalidationConditionCoverage === "number" &&
    typeof metrics.bottleneckCoverage === "number" &&
    typeof metrics.watchSignalDiscipline === "number" &&
    typeof metrics.averageCaseScore === "number" &&
    typeof metrics.promotionScore === "number"
  );
}

function isWorldModelCaseResultView(value: unknown): value is WorldModelCaseResultView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.fixtureId === "string" &&
    typeof result.passed === "boolean" &&
    typeof result.score === "number" &&
    typeof result.details === "object" &&
    result.details !== null &&
    Array.isArray((result.details as { checks?: unknown }).checks)
  );
}

function resolveEvalMetrics(run: HyperAgentOverviewRun | null): WorldModelEvalMetricsView | null {
  const metrics = run?.eval_run?.summary.metrics;
  return isWorldModelEvalMetricsView(metrics) ? metrics : null;
}

function resolveCaseResults(run: HyperAgentOverviewRun | null): WorldModelCaseResultView[] {
  const caseResults = run?.eval_run?.summary.caseResults;
  return Array.isArray(caseResults) ? caseResults.filter(isWorldModelCaseResultView) : [];
}

function resolveFixtureSetKey(run: HyperAgentOverviewRun | null): string | null {
  const fixtureSet = run?.eval_run?.summary.fixtureSet;
  return typeof fixtureSet === "string" ? fixtureSet : null;
}

function buildReviewPacket(params: {
  run: HyperAgentOverviewRun;
  artifact: HyperAgentOverviewRun["artifact"];
  artifactLabel: string;
  fixtureSet: HyperAgentFixtureSetSummary | null;
  lineage: HyperAgentLineageData | null;
  caseResults: WorldModelCaseResultView[];
  operatorNote: string | null;
}): HyperAgentReviewPacket {
  const { run, artifact, artifactLabel, fixtureSet, lineage, caseResults, operatorNote } = params;
  return {
    version: "hyperagent_review_packet.v1",
    generatedAt: new Date().toISOString(),
    artifact: artifact
      ? {
          key: artifact.artifactKey,
          label: artifactLabel,
          description: artifact.description ?? null,
          mutableFields: artifact.mutableFields,
        }
      : null,
    fixture_set: fixtureSet,
    recommendation: run.recommendation,
    promotion_score: resolvePromotionScore(run),
    gate: run.gate,
    diff: run.diff,
    snapshot: run.snapshot,
    variant: run.variant,
    eval_run: run.eval_run,
    case_results: caseResults,
    operator_note: operatorNote,
    applied_override: run.applied_override,
    runtime_applied: run.runtime_applied,
    lineage_run_id: run.lineage_run_id,
    lineage,
  };
}

async function loadHyperAgentControlData(statusFilter: StatusFilter): Promise<{
  overview: HyperAgentOverviewData;
  artifacts: HyperAgentArtifactsData["artifacts"];
  fixtures: HyperAgentFixtureSetSummary[];
  defaultFixtureSet: string;
}> {
  const [overview, artifacts, fixtureData] = await Promise.all([
    listV2HyperAgentOverview({
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 24,
    }),
    listV2HyperAgentArtifacts(),
    listV2HyperAgentWorldModelFixtures(),
  ]);
  return {
    overview,
    artifacts: artifacts.artifacts,
    fixtures: fixtureData.fixture_sets,
    defaultFixtureSet: fixtureData.default_fixture_set,
  };
}

function LineageNodeRow({
  nodeType,
  referenceId,
  metadata,
  locale,
}: {
  nodeType: string;
  referenceId: string;
  metadata: Record<string, unknown>;
  locale: "ko" | "en";
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{nodeType}</p>
      <p className="mt-2 font-mono text-[11px] text-neutral-900">{referenceId}</p>
      <p className="mt-2 break-all text-xs leading-5 text-neutral-600">{summarizeValue(metadata)}</p>
      <p className="mt-2 text-[10px] text-neutral-500">{locale === "ko" ? "메타데이터" : "Metadata"}</p>
    </div>
  );
}

function LineageEdgeRow({
  edgeType,
  sourceNodeId,
  targetNodeId,
  metadata,
}: {
  edgeType: string;
  sourceNodeId: string;
  targetNodeId: string;
  metadata: Record<string, unknown>;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{edgeType}</p>
      <p className="mt-2 font-mono text-[11px] text-neutral-900">
        {sourceNodeId.slice(0, 8)} → {targetNodeId.slice(0, 8)}
      </p>
      <p className="mt-2 break-all text-xs leading-5 text-neutral-600">{summarizeValue(metadata)}</p>
    </div>
  );
}

function DiffEntryRow({
  entry,
  locale,
}: {
  entry: HyperAgentArtifactDiffEntry;
  locale: "ko" | "en";
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-black/10 bg-white px-4 py-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          {locale === "ko" ? "변경 경로" : "Change path"}
        </p>
        <p className="break-all font-mono text-[12px] text-neutral-900">{entry.path || "(root)"}</p>
        <span className="inline-flex w-fit rounded-full border border-black/10 bg-black/[0.03] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-600">
          {entry.changeType}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-rose-600">{locale === "ko" ? "이전" : "Before"}</p>
          <p className="mt-2 break-all font-mono text-[11px] leading-5 text-rose-900">{summarizeValue(entry.before)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700">{locale === "ko" ? "이후" : "After"}</p>
          <p className="mt-2 break-all font-mono text-[11px] leading-5 text-emerald-900">{summarizeValue(entry.after)}</p>
        </div>
      </div>
    </div>
  );
}

export function HyperAgentControlModule() {
  const { locale } = useLocale();
  const resolvedLocale = locale === "ko" ? "ko" : "en";
  const [overview, setOverview] = useState<HyperAgentOverviewData | null>(null);
  const [artifacts, setArtifacts] = useState<HyperAgentArtifactsData["artifacts"]>([]);
  const [fixtureSets, setFixtureSets] = useState<HyperAgentFixtureSetSummary[]>([]);
  const [selectedFixtureSetKey, setSelectedFixtureSetKey] = useState("world_model_smoke_v1");
  const [lineage, setLineage] = useState<HyperAgentLineageData | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [utilityAction, setUtilityAction] = useState<string | null>(null);
  const [draftArtifactKey, setDraftArtifactKey] = useState<HyperAgentArtifactKey>("world_model_dossier_config");
  const [mutationBudget, setMutationBudget] = useState(1);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadHyperAgentControlData(statusFilter);
      startTransition(() => {
        setOverview(next.overview);
        setArtifacts(next.artifacts);
        setFixtureSets(next.fixtures);
        setSelectedFixtureSetKey((current) => {
          if (next.fixtures.some((fixture) => fixture.key === current)) {
            return current;
          }
          return next.defaultFixtureSet;
        });
        setSelectedRecommendationId((current) => {
          if (current && next.overview.runs.some((run) => run.recommendation.id === current)) {
            return current;
          }
          return next.overview.runs[0]?.recommendation.id ?? null;
        });
      });
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? "HyperAgent 상태를 불러오지 못했다." : "Failed to load HyperAgent state."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [resolvedLocale, statusFilter]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const selectedRun =
    overview?.runs.find((run) => run.recommendation.id === selectedRecommendationId) ?? overview?.runs[0] ?? null;

  useEffect(() => {
    const lineageRunId = selectedRun?.lineage_run_id;

    if (!lineageRunId) {
      setLineage(null);
      setLineageLoading(false);
      return;
    }
    const activeLineageRunId = lineageRunId;

    let cancelled = false;

    async function loadLineage() {
      setLineageLoading(true);
      try {
        const next = await getV2HyperAgentLineage(activeLineageRunId);
        if (!cancelled) {
          setLineage(next);
        }
      } catch {
        if (!cancelled) {
          setLineage(null);
        }
      } finally {
        if (!cancelled) {
          setLineageLoading(false);
        }
      }
    }

    void loadLineage();

    return () => {
      cancelled = true;
    };
  }, [
    selectedRun?.lineage_run_id,
    selectedRun?.recommendation.updatedAt,
    selectedRun?.recommendation.status,
    selectedRun?.lineage?.nodeCount,
    selectedRun?.lineage?.edgeCount,
  ]);

  const selectedArtifact =
    selectedRun?.artifact ??
    (selectedRun?.snapshot
      ? artifacts.find((artifact) => artifact.artifactKey === selectedRun.snapshot?.artifactKey) ?? null
      : null);
  const evalMetrics = resolveEvalMetrics(selectedRun);
  const caseResults = resolveCaseResults(selectedRun);
  const pendingCount = (overview?.summary.statuses.proposed ?? 0) + (overview?.summary.statuses.accepted ?? 0);
  const appliedSurfaceCount = artifacts.filter((artifact) => artifact.applied_override).length;
  const diffVolume = overview?.runs.reduce((sum, run) => sum + (run.diff?.changeCount ?? 0), 0) ?? 0;
  const draftArtifact = artifacts.find((artifact) => artifact.artifactKey === draftArtifactKey) ?? null;
  const supportsAutoRecommendation = draftArtifactKey === "world_model_dossier_config";
  const selectedFixture = fixtureSets.find((fixture) => fixture.key === selectedFixtureSetKey) ?? null;
  const selectedOperatorNote =
    typeof selectedRun?.recommendation.summary.operatorNote === "string"
      ? selectedRun.recommendation.summary.operatorNote
      : "";
  const selectedRunFixtureSetKey = resolveFixtureSetKey(selectedRun) ?? selectedFixtureSetKey;
  const selectedRunFixture = fixtureSets.find((fixture) => fixture.key === selectedRunFixtureSetKey) ?? null;
  const artifactLabel = selectedRun?.snapshot
    ? formatArtifactLabel(selectedRun.snapshot.artifactKey, resolvedLocale)
    : formatArtifactLabel(selectedArtifact?.artifactKey ?? "world_model_dossier_config", resolvedLocale);
  const effectiveOperatorNote = decisionNote.trim() || selectedOperatorNote || null;
  const reviewPacket = selectedRun
    ? buildReviewPacket({
        run: selectedRun,
        artifact: selectedArtifact,
        artifactLabel,
        fixtureSet: selectedRunFixture,
        lineage,
        caseResults,
        operatorNote: effectiveOperatorNote,
      })
    : null;
  const reviewPacketFilename = selectedRun
    ? `hyperagent-review-packet-${sanitizeFilenameSegment(selectedRun.recommendation.id)}-${selectedRun.recommendation.status}.json`
    : "hyperagent-review-packet.json";

  useEffect(() => {
    setDecisionNote(selectedOperatorNote);
  }, [selectedRun?.recommendation.id, selectedOperatorNote]);

  async function handleCopyJson(actionKey: string, label: string, value: unknown) {
    setUtilityAction(actionKey);
    setError(null);
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        throw new Error(
          resolvedLocale === "ko" ? "이 브라우저에서는 clipboard API를 사용할 수 없다." : "Clipboard API is not available in this browser."
        );
      }
      await navigator.clipboard.writeText(stringifyJson(value));
      setNotice(
        resolvedLocale === "ko" ? `${label} JSON을 clipboard에 복사했다.` : `Copied ${label} JSON to the clipboard.`
      );
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? `${label} JSON을 복사하지 못했다.` : `Failed to copy ${label} JSON.`
        )
      );
    } finally {
      setUtilityAction((current) => (current === actionKey ? null : current));
    }
  }

  function handleDownloadJson(label: string, filename: string, value: unknown) {
    setError(null);
    try {
      downloadJsonFile(filename, value);
      setNotice(
        resolvedLocale === "ko" ? `${label} JSON을 내려받았다.` : `Downloaded ${label} JSON.`
      );
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? `${label} JSON을 내려받지 못했다.` : `Failed to download ${label} JSON.`
        )
      );
    }
  }

  async function handleGenerateCandidate() {
    setBusyAction("generate");
    setError(null);
    setNotice(null);
    try {
      const snapshotResult = await createV2HyperAgentWorldModelSnapshot({
        artifact_key: draftArtifactKey,
      });
      const variantResult = await createV2HyperAgentWorldModelVariant({
        artifact_snapshot_id: snapshotResult.snapshot.id,
        mutation_budget: mutationBudget,
      });

      if (!supportsAutoRecommendation) {
        setNotice(
          resolvedLocale === "ko"
            ? `Radar artifact draft variant ${variantResult.variant.id.slice(0, 8)} 를 만들었다. 현재 UI에서는 dossier config만 eval/recommendation까지 자동으로 연결한다.`
            : `Created radar draft variant ${variantResult.variant.id.slice(0, 8)}. Only dossier config currently chains through eval and recommendation in the UI.`
        );
        return;
      }

      const evalResult = await createV2HyperAgentEval({
        variant_id: variantResult.variant.id,
        fixture_set: selectedFixtureSetKey,
      });
      const recommendationResult = await createV2HyperAgentRecommendation({
        eval_run_id: evalResult.eval_run.id,
      });
      startTransition(() => {
        setSelectedRecommendationId(recommendationResult.recommendation.id);
        if (statusFilter !== "all") {
          setStatusFilter("all");
        }
      });
      setNotice(
        resolvedLocale === "ko"
          ? `candidate ${recommendationResult.recommendation.id.slice(0, 8)} 를 생성했다. promotion ${formatPromotionScore({
              artifact: null,
              snapshot: null,
              variant: null,
              eval_run: evalResult.eval_run,
              recommendation: recommendationResult.recommendation,
              lineage_run_id: null,
              lineage: null,
              diff: null,
              gate: { passed: false, reasons: [] },
              applied_override: null,
              runtime_applied: false,
            })}`
          : `Created candidate ${recommendationResult.recommendation.id.slice(0, 8)} with promotion ${formatPromotionScore({
              artifact: null,
              snapshot: null,
              variant: null,
              eval_run: evalResult.eval_run,
              recommendation: recommendationResult.recommendation,
              lineage_run_id: null,
              lineage: null,
              diff: null,
              gate: { passed: false, reasons: [] },
              applied_override: null,
              runtime_applied: false,
            })}`
      );

      if (statusFilter === "all") {
        await refreshData();
      }
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? "HyperAgent candidate를 생성하지 못했다." : "Failed to create a HyperAgent candidate."
        )
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDecision(decision: "accept" | "reject") {
    if (!selectedRun) return;
    setBusyAction(decision);
    setError(null);
    setNotice(null);
    try {
      await decideV2HyperAgentRecommendation(selectedRun.recommendation.id, {
        decision,
        summary: {
          ...selectedRun.recommendation.summary,
          operatorNote: decisionNote.trim() || undefined,
          operatorDecision: decision,
        },
      });
      setNotice(
        decision === "accept"
          ? resolvedLocale === "ko"
            ? "선택한 recommendation을 accept 했다."
            : "Accepted the selected recommendation."
          : resolvedLocale === "ko"
            ? "선택한 recommendation을 reject 했다."
            : "Rejected the selected recommendation."
      );
      await refreshData();
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? "recommendation 결정을 저장하지 못했다." : "Failed to save recommendation decision."
        )
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApply() {
    if (!selectedRun) return;
    setBusyAction("apply");
    setError(null);
    setNotice(null);
    try {
      await applyV2HyperAgentRecommendation(selectedRun.recommendation.id);
      setNotice(
        resolvedLocale === "ko"
          ? "선택한 HyperAgent override를 runtime에 적용했다."
          : "Applied the selected HyperAgent override to runtime."
      );
      await refreshData();
    } catch (err) {
      setError(
        toErrorMessage(
          err,
          resolvedLocale === "ko" ? "HyperAgent override를 적용하지 못했다." : "Failed to apply the HyperAgent override."
        )
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="rounded-[28px] border border-black/10 bg-[linear-gradient(135deg,#fff8e8,rgba(255,248,232,0.72))] p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] uppercase tracking-[0.24em]">{resolvedLocale === "ko" ? "Queue" : "Queue"}</span>
            <Sparkles size={16} />
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{overview?.summary.total ?? 0}</p>
          <p className="mt-2 text-sm text-neutral-600">
            {resolvedLocale === "ko" ? "현재 필터에서 보이는 optimization run" : "Optimization runs visible in the current filter"}
          </p>
        </div>
        <div className="rounded-[28px] border border-black/10 bg-[linear-gradient(135deg,#eff7ee,rgba(239,247,238,0.82))] p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] uppercase tracking-[0.24em]">{resolvedLocale === "ko" ? "Pending Review" : "Pending Review"}</span>
            <ShieldAlert size={16} />
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{pendingCount}</p>
          <p className="mt-2 text-sm text-neutral-600">
            {resolvedLocale === "ko" ? "accept 또는 reject가 아직 남아 있는 recommendation" : "Recommendations still waiting for acceptance or rejection"}
          </p>
        </div>
        <div className="rounded-[28px] border border-black/10 bg-[linear-gradient(135deg,#eef5ff,rgba(238,245,255,0.82))] p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] uppercase tracking-[0.24em]">{resolvedLocale === "ko" ? "Applied Surfaces" : "Applied Surfaces"}</span>
            <ShieldCheck size={16} />
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{appliedSurfaceCount}</p>
          <p className="mt-2 text-sm text-neutral-600">
            {resolvedLocale === "ko" ? "runtime override가 현재 걸린 artifact surface" : "Artifact surfaces with a runtime override currently applied"}
          </p>
        </div>
        <div className="rounded-[28px] border border-black/10 bg-[linear-gradient(135deg,#f8f1ff,rgba(248,241,255,0.8))] p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] uppercase tracking-[0.24em]">{resolvedLocale === "ko" ? "Diff Volume" : "Diff Volume"}</span>
            <GitBranch size={16} />
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{diffVolume}</p>
          <p className="mt-2 text-sm text-neutral-600">
            {resolvedLocale === "ko" ? "현재 목록에 보이는 bounded mutation entry 수" : "Bounded mutation entries visible in the current run list"}
          </p>
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText={resolvedLocale === "ko" ? "HyperAgent 표면을 불러오는 중..." : "Loading HyperAgent surfaces..."}
        onRetry={() => void refreshData()}
      />

      {!loading && !error ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <section className="rounded-[30px] border border-black/10 bg-[#fff9ec] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 pb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
                  {resolvedLocale === "ko" ? "Run Queue" : "Run Queue"}
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
                  {resolvedLocale === "ko" ? "promotion-gated self-modification" : "Promotion-gated self-modification"}
                </h3>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
                onClick={() => void refreshData()}
              >
                <RefreshCw size={14} />
                {resolvedLocale === "ko" ? "새로고침" : "Refresh"}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition ${
                    statusFilter === status
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-black/10 bg-white text-neutral-600 hover:bg-neutral-100"
                  }`}
                  onClick={() => setStatusFilter(status)}
                >
                  {formatStatusLabel(status, resolvedLocale)} · {status === "all" ? overview?.summary.total ?? 0 : overview?.summary.statuses[status] ?? 0}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-[24px] border border-black/10 bg-white px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    {resolvedLocale === "ko" ? "Candidate Builder" : "Candidate Builder"}
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                    {supportsAutoRecommendation
                      ? resolvedLocale === "ko"
                        ? "snapshot, variant, eval, recommendation을 한 번에 생성한다. dossier config는 선택한 fixture set으로 자동 평가한다."
                        : "Create snapshot, variant, eval, and recommendation in one pass. Dossier config is auto-evaluated with the selected fixture set."
                      : resolvedLocale === "ko"
                        ? "현재 radar artifact는 bounded draft variant까지만 생성한다. recommendation 자동화는 dossier config evaluator가 있는 surface에만 연결돼 있다."
                        : "Radar artifacts currently create bounded draft variants only. Recommendation automation is wired only to surfaces that have a dossier-config evaluator."}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-2xl border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500"
                  onClick={() => void handleGenerateCandidate()}
                  disabled={busyAction !== null}
                >
                  <Sparkles size={14} />
                  {busyAction === "generate"
                    ? "..."
                    : supportsAutoRecommendation
                      ? resolvedLocale === "ko"
                        ? "Generate Candidate"
                        : "Generate Candidate"
                      : resolvedLocale === "ko"
                        ? "Create Variant Draft"
                        : "Create Variant Draft"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <label className="grid gap-2 text-sm text-neutral-700">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                    {resolvedLocale === "ko" ? "Artifact Surface" : "Artifact Surface"}
                  </span>
                  <select
                    className="rounded-2xl border border-black/10 bg-[#fff9ec] px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-900"
                    value={draftArtifactKey}
                    onChange={(event) => setDraftArtifactKey(event.target.value as HyperAgentArtifactKey)}
                    disabled={busyAction !== null}
                  >
                    {artifacts.map((artifact) => (
                      <option key={artifact.artifactKey} value={artifact.artifactKey}>
                        {formatArtifactLabel(artifact.artifactKey, resolvedLocale)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-2 text-sm text-neutral-700">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                    {resolvedLocale === "ko" ? "Mutation Budget" : "Mutation Budget"}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3].map((budget) => (
                      <button
                        key={budget}
                        type="button"
                        className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                          mutationBudget === budget
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-black/10 bg-[#fff9ec] text-neutral-700 hover:bg-neutral-100"
                        }`}
                        onClick={() => setMutationBudget(budget)}
                        disabled={busyAction !== null}
                      >
                        {budget}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {supportsAutoRecommendation ? (
                <div className="mt-4 grid gap-2 text-sm text-neutral-700">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                    {resolvedLocale === "ko" ? "Fixture Set" : "Fixture Set"}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {fixtureSets.map((fixture) => (
                      <button
                        key={fixture.key}
                        type="button"
                        className={`rounded-full border px-3 py-2 text-xs transition ${
                          selectedFixtureSetKey === fixture.key
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-black/10 bg-[#fff9ec] text-neutral-700 hover:bg-neutral-100"
                        }`}
                        onClick={() => setSelectedFixtureSetKey(fixture.key)}
                        disabled={busyAction !== null}
                      >
                        {fixture.title} · {fixture.fixtureCount}
                      </button>
                    ))}
                  </div>
                  {selectedFixture ? (
                    <p className="text-sm leading-6 text-neutral-600">
                      {selectedFixture.description}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {draftArtifact ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {draftArtifact.mutableFields.map((field) => (
                    <span key={field} className="rounded-full border border-black/10 bg-[#fffdf8] px-3 py-1.5 font-mono text-[11px] text-neutral-700">
                      {field}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              {(overview?.runs ?? []).map((run) => {
                const artifactLabel = run.snapshot
                  ? formatArtifactLabel(run.snapshot.artifactKey, resolvedLocale)
                  : formatArtifactLabel(run.artifact?.artifactKey ?? "world_model_dossier_config", resolvedLocale);
                const isSelected = run.recommendation.id === selectedRun?.recommendation.id;
                return (
                  <button
                    key={run.recommendation.id}
                    type="button"
                    className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                      isSelected
                        ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                        : "border-black/10 bg-white hover:border-black/20 hover:bg-neutral-50"
                    }`}
                    onClick={() => {
                      startTransition(() => {
                        setSelectedRecommendationId(run.recommendation.id);
                      });
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className={`text-[11px] uppercase tracking-[0.22em] ${isSelected ? "text-white/65" : "text-neutral-500"}`}>
                          {artifactLabel}
                        </p>
                        <p className={`mt-2 text-sm ${isSelected ? "text-white/85" : "text-neutral-600"}`}>
                          {run.snapshot?.artifactVersion ?? "snapshot"} · {formatTimestamp(run.recommendation.updatedAt, resolvedLocale)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                          isSelected ? "border-white/20 bg-white/10 text-white" : formatStatusTone(run.recommendation.status)
                        }`}
                      >
                        {formatStatusLabel(run.recommendation.status, resolvedLocale)}
                      </span>
                    </div>
                    <div className={`mt-4 grid gap-2 text-sm md:grid-cols-3 ${isSelected ? "text-white/80" : "text-neutral-700"}`}>
                      <p>{resolvedLocale === "ko" ? "Promotion" : "Promotion"} {formatPromotionScore(run)}</p>
                      <p>{resolvedLocale === "ko" ? "Diff" : "Diff"} {run.diff?.changeCount ?? 0}</p>
                      <p>{resolvedLocale === "ko" ? "Lineage" : "Lineage"} {run.lineage?.nodeCount ?? 0}/{run.lineage?.edgeCount ?? 0}</p>
                    </div>
                    {run.runtime_applied ? (
                      <p className={`mt-3 text-xs ${isSelected ? "text-emerald-200" : "text-emerald-700"}`}>
                        {resolvedLocale === "ko" ? "현재 runtime override로 적용 중" : "Currently applied as the runtime override"}
                      </p>
                    ) : null}
                  </button>
                );
              })}

              {overview?.runs.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-black/10 bg-white px-5 py-8 text-sm text-neutral-600">
                  <p className="font-medium text-neutral-900">
                    {resolvedLocale === "ko" ? "아직 표시할 HyperAgent run이 없다." : "There are no HyperAgent runs to show yet."}
                  </p>
                  <p className="mt-2 leading-6">
                    {resolvedLocale === "ko"
                      ? "이 표면은 snapshot, variant, eval, recommendation이 백엔드에서 생성된 뒤 review/apply 용도로 쓴다."
                      : "This surface is for review and apply after snapshots, variants, evals, and recommendations have been created by the backend."}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[30px] border border-black/10 bg-white p-5 shadow-sm">
            {selectedRun ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/8 pb-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
                      {selectedRun.snapshot
                        ? formatArtifactLabel(selectedRun.snapshot.artifactKey, resolvedLocale)
                        : resolvedLocale === "ko"
                          ? "선택된 run"
                          : "Selected run"}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                      {resolvedLocale === "ko" ? "bounded mutation inspector" : "Bounded mutation inspector"}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
                      {selectedArtifact?.description ??
                        (resolvedLocale === "ko"
                          ? "artifact diff, gate, lineage를 이곳에서 검토한다."
                          : "Review the artifact diff, gate result, and lineage from this inspector.")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedRun.recommendation.status === "proposed" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleDecision("accept")}
                        disabled={busyAction !== null}
                      >
                        <CheckCircle2 size={14} />
                        {busyAction === "accept" ? "..." : resolvedLocale === "ko" ? "Accept" : "Accept"}
                      </button>
                    ) : null}
                    {selectedRun.recommendation.status !== "rejected" && selectedRun.recommendation.status !== "applied" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleDecision("reject")}
                        disabled={busyAction !== null}
                      >
                        <XCircle size={14} />
                        {busyAction === "reject" ? "..." : resolvedLocale === "ko" ? "Reject" : "Reject"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-2xl border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500"
                      onClick={() => void handleApply()}
                      disabled={
                        busyAction !== null ||
                        !selectedRun.gate.passed ||
                        (selectedRun.recommendation.status !== "accepted" && selectedRun.recommendation.status !== "applied") ||
                        selectedRun.runtime_applied
                      }
                    >
                      <ShieldCheck size={14} />
                      {busyAction === "apply"
                        ? "..."
                        : selectedRun.runtime_applied
                          ? resolvedLocale === "ko"
                            ? "Applied"
                            : "Applied"
                          : resolvedLocale === "ko"
                            ? "Apply"
                            : "Apply"}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[#fffdf8] px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Operator Note" : "Operator Note"}</p>
                  <textarea
                    className="mt-3 min-h-[92px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-900"
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder={
                      resolvedLocale === "ko"
                        ? "accept/reject 이유, observed risk, follow-up 조건을 남긴다."
                        : "Record why you accepted or rejected this run, plus any observed risk or follow-up condition."
                    }
                    disabled={busyAction !== null}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-black/10 bg-[#fff9ec] px-4 py-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Status" : "Status"}</p>
                    <p className="mt-2 text-base font-semibold text-neutral-950">{formatStatusLabel(selectedRun.recommendation.status, resolvedLocale)}</p>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-[#f4f8ff] px-4 py-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Promotion" : "Promotion"}</p>
                    <p className="mt-2 text-base font-semibold text-neutral-950">{formatPromotionScore(selectedRun)}</p>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-[#eef7ef] px-4 py-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Diff Entries" : "Diff Entries"}</p>
                    <p className="mt-2 text-base font-semibold text-neutral-950">{selectedRun.diff?.changeCount ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-[#f8f3ff] px-4 py-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Lineage" : "Lineage"}</p>
                    <p className="mt-2 text-base font-semibold text-neutral-950">
                      {selectedRun.lineage?.nodeCount ?? 0}/{selectedRun.lineage?.edgeCount ?? 0}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.85fr,1.15fr]">
                  <div className="space-y-4 rounded-[26px] border border-black/10 bg-[#fffdf8] p-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Gate" : "Gate"}</p>
                      <div className="mt-3 flex items-center gap-2">
                        {selectedRun.gate.passed ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-amber-600" />}
                        <span className="text-sm font-medium text-neutral-900">
                          {selectedRun.gate.passed
                            ? resolvedLocale === "ko"
                              ? "apply gate 통과"
                              : "Apply gate passed"
                            : resolvedLocale === "ko"
                              ? "apply gate 차단"
                              : "Apply gate blocked"}
                        </span>
                      </div>
                      {selectedRun.gate.reasons.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {selectedRun.gate.reasons.map((reason) => (
                            <p key={reason} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                              {formatGateReason(reason, resolvedLocale)}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-neutral-600">
                          {resolvedLocale === "ko"
                            ? "현재 recommendation summary와 status 기준으로 runtime apply가 허용된다."
                            : "Runtime apply is currently allowed based on recommendation status and summary."}
                        </p>
                      )}
                    </div>

                    <div className="border-t border-black/8 pt-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Eval Scorecard" : "Eval Scorecard"}</p>
                      {evalMetrics ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {[
                            ["Primary thesis", evalMetrics.primaryThesisCoverage],
                            ["Counter hypothesis", evalMetrics.counterHypothesisRetained],
                            ["Invalidation", evalMetrics.invalidationConditionCoverage],
                            ["Bottlenecks", evalMetrics.bottleneckCoverage],
                            ["Watch discipline", evalMetrics.watchSignalDiscipline],
                            ["Average case", evalMetrics.averageCaseScore],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-2xl border border-black/10 bg-white px-3 py-3">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">{label}</p>
                              <p className="mt-2 text-sm font-semibold text-neutral-900">{Number(value).toFixed(3)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-neutral-500">
                          {resolvedLocale === "ko" ? "표시할 eval metrics가 없다." : "No eval metrics are available."}
                        </p>
                      )}
                    </div>

                    <div className="border-t border-black/8 pt-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Run Meta" : "Run Meta"}</p>
                      <div className="mt-3 space-y-2 text-sm text-neutral-700">
                        <p>{resolvedLocale === "ko" ? "Lineage run" : "Lineage run"}: <span className="font-mono text-[12px] text-neutral-900">{selectedRun.lineage_run_id ?? "-"}</span></p>
                        <p>{resolvedLocale === "ko" ? "Variant" : "Variant"}: <span className="font-mono text-[12px] text-neutral-900">{selectedRun.variant?.id.slice(0, 8) ?? "-"}</span></p>
                        <p>{resolvedLocale === "ko" ? "Eval run" : "Eval run"}: <span className="font-mono text-[12px] text-neutral-900">{selectedRun.eval_run?.id.slice(0, 8) ?? "-"}</span></p>
                        <p>{resolvedLocale === "ko" ? "Updated" : "Updated"}: {formatTimestamp(selectedRun.recommendation.updatedAt, resolvedLocale)}</p>
                      </div>
                    </div>

                    <div className="border-t border-black/8 pt-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Mutable Fields" : "Mutable Fields"}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(selectedArtifact?.mutableFields ?? []).map((field) => (
                          <span
                            key={field}
                            className="rounded-full border border-black/10 bg-white px-3 py-1.5 font-mono text-[11px] text-neutral-700"
                          >
                            {field}
                          </span>
                        ))}
                        {(selectedArtifact?.mutableFields ?? []).length === 0 ? (
                          <p className="text-sm text-neutral-500">
                            {resolvedLocale === "ko" ? "표시할 mutable field가 없다." : "No mutable fields are available."}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="border-t border-black/8 pt-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Fixture Policy" : "Fixture Policy"}</p>
                      <div className="mt-3 space-y-2 text-sm text-neutral-700">
                        <p>
                          {resolvedLocale === "ko" ? "현재 builder fixture" : "Current builder fixture"}:{" "}
                          <span className="font-medium text-neutral-900">{selectedFixture?.title ?? selectedFixtureSetKey}</span>
                        </p>
                        {selectedFixture ? (
                          <p className="leading-6 text-neutral-600">{selectedFixture.description}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[26px] border border-black/10 bg-[#fffdf8] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Diff Preview" : "Diff Preview"}</p>
                        <p className="mt-2 text-sm text-neutral-600">
                          {resolvedLocale === "ko"
                            ? "bounded mutation에서 실제로 바뀐 경로만 보여준다."
                            : "Only paths changed by the bounded mutation are shown here."}
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-neutral-600">
                        <Waypoints size={13} />
                        {selectedRun.diff?.changeCount ?? 0}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {caseResults.length > 0 ? (
                        <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Case Results" : "Case Results"}</p>
                          <div className="mt-3 space-y-3">
                            {caseResults.slice(0, 6).map((result) => (
                              <div key={result.fixtureId} className="rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="font-medium text-neutral-900">{result.fixtureId}</p>
                                  <span
                                    className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                                      result.passed
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-amber-200 bg-amber-50 text-amber-700"
                                    }`}
                                  >
                                    {result.passed ? "pass" : "needs review"}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-neutral-600">
                                  {resolvedLocale === "ko" ? "score" : "score"} {result.score.toFixed(3)} · {resolvedLocale === "ko" ? "checks" : "checks"} {result.details.checks.length}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {(selectedRun.diff?.entries ?? []).slice(0, 12).map((entry) => (
                        <DiffEntryRow key={`${entry.path}:${entry.changeType}`} entry={entry} locale={resolvedLocale} />
                      ))}
                      {(selectedRun.diff?.entries ?? []).length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-8 text-sm text-neutral-500">
                          {resolvedLocale === "ko" ? "표시할 diff entry가 없다." : "There are no diff entries to show."}
                        </div>
                      ) : null}
                    </div>

                    {selectedRun.applied_override ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                          {resolvedLocale === "ko" ? "Runtime Override" : "Runtime Override"}
                        </p>
                        <p className="mt-2 text-sm text-emerald-900">
                          {resolvedLocale === "ko"
                            ? `${formatTimestamp(selectedRun.applied_override.appliedAt, resolvedLocale)}에 적용됨`
                            : `Applied at ${formatTimestamp(selectedRun.applied_override.appliedAt, resolvedLocale)}`}
                        </p>
                        <p className="mt-2 break-all font-mono text-[11px] leading-5 text-emerald-900">
                          {summarizeValue(selectedRun.applied_override.payload)}
                        </p>
                      </div>
                    ) : null}

                    {selectedRun.applied_override ? (
                      <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            {resolvedLocale === "ko" ? "Applied Payload JSON" : "Applied Payload JSON"}
                          </p>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fff9ec] px-3 py-1.5 text-[11px] text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleCopyJson("copy-applied-payload", "Applied Payload", selectedRun.applied_override)}
                            disabled={utilityAction !== null}
                          >
                            <Copy size={13} />
                            {utilityAction === "copy-applied-payload" ? "..." : "Copy Applied Payload"}
                          </button>
                        </div>
                        <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-black/10 bg-[#fffdf8] px-4 py-4 text-[11px] leading-5 text-neutral-800">
                          {stringifyJson(selectedRun.applied_override)}
                        </pre>
                      </div>
                    ) : null}

                    {reviewPacket ? (
                      <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                              {resolvedLocale === "ko" ? "Review Packet JSON" : "Review Packet JSON"}
                            </p>
                            <p className="mt-2 text-sm text-neutral-600">
                              {resolvedLocale === "ko"
                                ? "diff, gate, lineage, operator note, applied payload를 하나의 감사용 packet으로 묶는다."
                                : "Bundles diff, gate, lineage, operator notes, and applied payload into one audit packet."}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fff9ec] px-3 py-1.5 text-[11px] text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => void handleCopyJson("copy-review-packet", "Review Packet", reviewPacket)}
                              disabled={utilityAction !== null}
                            >
                              <Copy size={13} />
                              {utilityAction === "copy-review-packet" ? "..." : "Copy Review Packet"}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-[11px] text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500"
                              onClick={() => handleDownloadJson("Review Packet", reviewPacketFilename, reviewPacket)}
                              disabled={utilityAction !== null}
                            >
                              <Download size={13} />
                              Download Review Packet
                            </button>
                          </div>
                        </div>
                        <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-black/10 bg-[#fffdf8] px-4 py-4 text-[11px] leading-5 text-neutral-800">
                          {stringifyJson(reviewPacket)}
                        </pre>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Lineage Detail" : "Lineage Detail"}</p>
                          <p className="mt-2 text-sm text-neutral-600">
                            {resolvedLocale === "ko"
                              ? "선택한 run의 lineage node와 edge를 그대로 보여준다."
                              : "Shows the node and edge trail for the selected run."}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fff9ec] px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-neutral-600">
                          <GitBranch size={13} />
                          {lineage?.lineage.nodes.length ?? 0}/{lineage?.lineage.edges.length ?? 0}
                        </div>
                      </div>

                      {lineageLoading ? (
                        <p className="mt-4 text-sm text-neutral-500">
                          {resolvedLocale === "ko" ? "lineage를 불러오는 중..." : "Loading lineage..."}
                        </p>
                      ) : lineage ? (
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <div className="space-y-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Nodes" : "Nodes"}</p>
                            {(lineage.lineage.nodes ?? []).slice(0, 8).map((node) => (
                              <LineageNodeRow
                                key={node.id}
                                nodeType={node.nodeType}
                                referenceId={node.referenceId}
                                metadata={node.metadata}
                                locale={resolvedLocale}
                              />
                            ))}
                            {lineage.lineage.nodes.length === 0 ? (
                              <p className="text-sm text-neutral-500">
                                {resolvedLocale === "ko" ? "node가 없다." : "No nodes recorded."}
                              </p>
                            ) : null}
                          </div>
                          <div className="space-y-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{resolvedLocale === "ko" ? "Edges" : "Edges"}</p>
                            {(lineage.lineage.edges ?? []).slice(0, 8).map((edge) => (
                              <LineageEdgeRow
                                key={edge.id}
                                edgeType={edge.edgeType}
                                sourceNodeId={edge.sourceNodeId}
                                targetNodeId={edge.targetNodeId}
                                metadata={edge.metadata}
                              />
                            ))}
                            {lineage.lineage.edges.length === 0 ? (
                              <p className="text-sm text-neutral-500">
                                {resolvedLocale === "ko" ? "edge가 없다." : "No edges recorded."}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-neutral-500">
                          {resolvedLocale === "ko" ? "표시할 lineage가 없다." : "There is no lineage to display."}
                        </p>
                      )}
                    </div>

                    {lineage ? (
                      <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            {resolvedLocale === "ko" ? "Lineage JSON" : "Lineage JSON"}
                          </p>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fff9ec] px-3 py-1.5 text-[11px] text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleCopyJson("copy-lineage", "Lineage", lineage)}
                            disabled={utilityAction !== null}
                          >
                            <Copy size={13} />
                            {utilityAction === "copy-lineage" ? "..." : "Copy Lineage JSON"}
                          </button>
                        </div>
                        <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-black/10 bg-[#fffdf8] px-4 py-4 text-[11px] leading-5 text-neutral-800">
                          {stringifyJson(lineage)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[440px] flex-col justify-between rounded-[28px] border border-dashed border-black/10 bg-[#fffdf8] p-6">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
                    {resolvedLocale === "ko" ? "Artifact Catalog" : "Artifact Catalog"}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                    {resolvedLocale === "ko" ? "review queue가 비어 있어도 surface는 본다." : "See the surfaces even when the review queue is empty."}
                  </h3>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
                    {resolvedLocale === "ko"
                      ? "HyperAgent는 자유 수정이 아니라 allowlisted artifact만 bounded mutation 한다."
                      : "HyperAgent only mutates allowlisted artifacts inside a bounded surface, not the full system."}
                  </p>
                </div>
                <div className="mt-6 grid gap-3">
                  {artifacts.map((artifact) => (
                    <div key={artifact.artifactKey} className="rounded-[24px] border border-black/10 bg-white px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                            {formatArtifactLabel(artifact.artifactKey, resolvedLocale)}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-neutral-600">{artifact.description}</p>
                        </div>
                        {artifact.applied_override ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                            {resolvedLocale === "ko" ? "Applied" : "Applied"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {artifact.mutableFields.map((field) => (
                          <span key={field} className="rounded-full border border-black/10 bg-[#fff9ec] px-3 py-1.5 font-mono text-[11px] text-neutral-700">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
