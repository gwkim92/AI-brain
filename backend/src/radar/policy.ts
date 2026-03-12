import type {
  RadarAutonomyDecisionRecord,
  RadarControlSettingsRecord,
  RadarDomainPackMetricRecord,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarExecutionMode,
  RadarKillSwitchScope,
  RadarOperatorFeedbackRecord,
  RadarPromotionDecision,
  RadarRecommendationRecord,
  RadarSourceTier,
  WorldModelOutcomeResult,
} from '../store/types';

export const DEFAULT_RADAR_CONTROL_SETTINGS: RadarControlSettingsRecord = {
  globalKillSwitch: false,
  autoExecutionEnabled: true,
  dossierPromotionEnabled: true,
  tier3EscalationEnabled: true,
  disabledDomainIds: [],
  disabledSourceTiers: [],
  updatedBy: null,
  updatedAt: new Date(0).toISOString(),
};

function clamp01(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function recommendationDecisionForPromotion(decision: RadarPromotionDecision): RadarRecommendationRecord['decision'] {
  if (decision === 'ignore') return 'discard';
  if (decision === 'watch') return 'hold';
  return 'adopt';
}

function executionModeForDecision(decision: RadarPromotionDecision): RadarExecutionMode {
  if (decision === 'ignore' || decision === 'watch') return 'watch_only';
  if (decision === 'dossier') return 'dossier_only';
  if (decision === 'action') return 'proposal_auto';
  return 'execute_auto';
}

function capPromotionDecision(
  current: RadarPromotionDecision,
  next: RadarPromotionDecision
): RadarPromotionDecision {
  const rank: Record<RadarPromotionDecision, number> = {
    ignore: 0,
    watch: 1,
    dossier: 2,
    action: 3,
    execute_auto_candidate: 4,
  };
  return rank[next] < rank[current] ? next : current;
}

export function createDefaultRadarDomainPackMetric(
  domainId: RadarDomainPackMetricRecord['domainId'],
  now: string
): RadarDomainPackMetricRecord {
  return {
    domainId,
    calibrationScore: 0.75,
    evaluationCount: 0,
    promotionCount: 0,
    dossierCount: 0,
    actionCount: 0,
    autoExecuteCount: 0,
    overrideCount: 0,
    ackCount: 0,
    confirmedCount: 0,
    invalidatedCount: 0,
    mixedCount: 0,
    unresolvedCount: 0,
    lastEventAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function recomputeRadarCalibrationScore(
  metric: Pick<
    RadarDomainPackMetricRecord,
    | 'evaluationCount'
    | 'promotionCount'
    | 'overrideCount'
    | 'ackCount'
    | 'autoExecuteCount'
    | 'confirmedCount'
    | 'invalidatedCount'
    | 'mixedCount'
    | 'unresolvedCount'
  >
): number {
  const evaluationBase = Math.min(0.12, metric.evaluationCount * 0.01);
  const ackRate = metric.ackCount / Math.max(1, metric.evaluationCount);
  const overrideRate = metric.overrideCount / Math.max(1, metric.promotionCount);
  const autoRate = metric.autoExecuteCount / Math.max(1, metric.promotionCount);
  const confirmedRate = metric.confirmedCount / Math.max(1, metric.evaluationCount);
  const invalidatedRate = metric.invalidatedCount / Math.max(1, metric.evaluationCount);
  const mixedRate = metric.mixedCount / Math.max(1, metric.evaluationCount);
  const unresolvedRate = metric.unresolvedCount / Math.max(1, metric.evaluationCount);
  return clamp01(
    0.66 +
      evaluationBase +
      ackRate * 0.12 +
      confirmedRate * 0.18 -
      overrideRate * 0.32 -
      invalidatedRate * 0.34 -
      mixedRate * 0.12 -
      unresolvedRate * 0.04 -
      autoRate * 0.06
  );
}

export function applyRadarPolicyControls(input: {
  events: RadarEventRecord[];
  posteriors: RadarDomainPosteriorRecord[];
  autonomyDecisions: RadarAutonomyDecisionRecord[];
  recommendations: RadarRecommendationRecord[];
  control: RadarControlSettingsRecord;
  metricsByDomain: Map<RadarDomainPackMetricRecord['domainId'], RadarDomainPackMetricRecord>;
}): {
  events: RadarEventRecord[];
  autonomyDecisions: RadarAutonomyDecisionRecord[];
  recommendations: RadarRecommendationRecord[];
} {
  const events = input.events.map((event) => ({ ...event }));
  const autonomyDecisions = input.autonomyDecisions.map((row) => ({ ...row, policyReasons: [...row.policyReasons] }));
  const recommendations = input.recommendations.map((row) => ({ ...row, domainIds: [...(row.domainIds ?? [])] }));

  for (const event of events) {
    const autonomy = autonomyDecisions.find((row) => row.eventId === event.id);
    const recommendation = recommendations.find((row) => row.eventId === event.id);
    if (!autonomy || !recommendation) {
      continue;
    }
    const eventPosteriors = input.posteriors
      .filter((posterior) => posterior.eventId === event.id)
      .sort((left, right) => right.score - left.score);
    const topPosterior = eventPosteriors[0] ?? null;
    const topDomain = topPosterior?.domainId ?? null;
    const metric = topDomain ? input.metricsByDomain.get(topDomain) ?? null : null;
    let decision = event.decision;
    let killSwitchScope: RadarKillSwitchScope = 'none';
    const hasTier3 = event.sourceMix.sourceTiers.includes('tier_3');
    const socialOnly = (event.sourceMix.nonSocialSourceCount ?? 0) === 0;
    const hasMetricCorroboration = event.corroborationDetail.hasMetricCorroboration;
    const hasCounterHypothesis = (topPosterior?.counterFeatures.length ?? 0) > 0;

    if (input.control.globalKillSwitch) {
      decision = 'ignore';
      killSwitchScope = 'global';
      autonomy.policyReasons.push('kill_switch:global');
    } else {
      const blockedSourceTier = event.sourceMix.sourceTiers.find((tier) => input.control.disabledSourceTiers.includes(tier));
      if (blockedSourceTier) {
        decision = 'ignore';
        killSwitchScope = 'source_tier';
        autonomy.policyReasons.push(`kill_switch:source_tier:${blockedSourceTier}`);
      }
      if (topDomain && input.control.disabledDomainIds.includes(topDomain)) {
        decision = capPromotionDecision(decision, 'watch');
        killSwitchScope = 'domain_pack';
        autonomy.policyReasons.push(`kill_switch:domain:${topDomain}`);
      }
      if (!input.control.tier3EscalationEnabled && hasTier3) {
        decision = capPromotionDecision(decision, 'watch');
        killSwitchScope = killSwitchScope === 'none' ? 'source_tier' : killSwitchScope;
        autonomy.policyReasons.push('tier3_escalation_disabled');
      }
      if (hasTier3 && decision !== 'ignore' && decision !== 'watch' && socialOnly && !hasMetricCorroboration) {
        decision = 'watch';
        autonomy.policyReasons.push('social_only_corroboration_missing');
      } else if (
        hasTier3 &&
        decision !== 'ignore' &&
        decision !== 'watch' &&
        (event.sourceMix.nonSocialSourceCount ?? 0) < 1 &&
        !hasMetricCorroboration
      ) {
        decision = 'watch';
        autonomy.policyReasons.push('tier3_dossier_gate_not_met');
      }
      if (
        hasTier3 &&
        (decision === 'action' || decision === 'execute_auto_candidate') &&
        (
          (event.sourceMix.nonSocialSourceCount ?? 0) < 2 ||
          !event.expectedNextSignals.length ||
          !hasCounterHypothesis ||
          (metric?.calibrationScore ?? 0) < 0.7
        )
      ) {
        decision = 'dossier';
        autonomy.policyReasons.push('tier3_action_gate_not_met');
      }
      if (!input.control.dossierPromotionEnabled && decision !== 'ignore' && decision !== 'watch') {
        decision = 'watch';
        autonomy.policyReasons.push('dossier_promotion_disabled');
      }
      if (!input.control.autoExecutionEnabled && decision === 'execute_auto_candidate') {
        decision = 'action';
        autonomy.policyReasons.push('auto_execution_disabled');
      }
      if (metric && metric.calibrationScore < 0.55 && (decision === 'action' || decision === 'execute_auto_candidate')) {
        decision = 'dossier';
        autonomy.policyReasons.push(`pack_calibration_low:${metric.calibrationScore.toFixed(2)}`);
      } else if (metric && metric.calibrationScore < 0.7 && decision === 'execute_auto_candidate') {
        decision = 'action';
        autonomy.policyReasons.push(`pack_calibration_auto_block:${metric.calibrationScore.toFixed(2)}`);
      }
    }

    event.decision = decision;
    autonomy.killSwitchScope = killSwitchScope;
    autonomy.executionMode = executionModeForDecision(decision);
    autonomy.requiresHuman = autonomy.executionMode === 'approval_required';
    autonomy.updatedAt = event.updatedAt;
    recommendation.decision = recommendationDecisionForPromotion(decision);
    recommendation.promotionDecision = decision;
    recommendation.autonomyExecutionMode = autonomy.executionMode;
  }

  return { events, autonomyDecisions, recommendations };
}

export function applyRadarFeedbackToMetric(input: {
  metric: RadarDomainPackMetricRecord;
  feedback: Pick<RadarOperatorFeedbackRecord, 'kind' | 'createdAt'>;
}): RadarDomainPackMetricRecord {
  const next: RadarDomainPackMetricRecord = {
    ...input.metric,
    ackCount: input.metric.ackCount + (input.feedback.kind === 'ack' ? 1 : 0),
    overrideCount: input.metric.overrideCount + (input.feedback.kind === 'override' ? 1 : 0),
    lastEventAt: input.feedback.createdAt,
    updatedAt: input.feedback.createdAt,
  };
  next.calibrationScore = recomputeRadarCalibrationScore(next);
  return next;
}

export function applyRadarOutcomeToMetric(input: {
  metric: RadarDomainPackMetricRecord;
  result: WorldModelOutcomeResult;
  evaluatedAt: string;
}): RadarDomainPackMetricRecord {
  const decay = (value: number): number => Math.max(0, Math.round(value * 0.94 * 1000) / 1000);
  const next: RadarDomainPackMetricRecord = {
    ...input.metric,
    confirmedCount: decay(input.metric.confirmedCount) + (input.result === 'confirmed' ? 1 : 0),
    invalidatedCount: decay(input.metric.invalidatedCount) + (input.result === 'invalidated' ? 1 : 0),
    mixedCount: decay(input.metric.mixedCount) + (input.result === 'mixed' ? 1 : 0),
    unresolvedCount: decay(input.metric.unresolvedCount) + (input.result === 'unresolved' ? 1 : 0),
    lastEventAt: input.evaluatedAt,
    updatedAt: input.evaluatedAt,
  };
  next.calibrationScore = recomputeRadarCalibrationScore(next);
  return next;
}

export function applyRadarEvaluationToMetric(input: {
  metric: RadarDomainPackMetricRecord;
  event: Pick<RadarEventRecord, 'decision' | 'updatedAt'>;
}): RadarDomainPackMetricRecord {
  const next: RadarDomainPackMetricRecord = {
    ...input.metric,
    evaluationCount: input.metric.evaluationCount + 1,
    promotionCount: input.metric.promotionCount + (input.event.decision === 'ignore' || input.event.decision === 'watch' ? 0 : 1),
    dossierCount: input.metric.dossierCount + (input.event.decision === 'dossier' ? 1 : 0),
    actionCount: input.metric.actionCount + (input.event.decision === 'action' ? 1 : 0),
    autoExecuteCount: input.metric.autoExecuteCount + (input.event.decision === 'execute_auto_candidate' ? 1 : 0),
    lastEventAt: input.event.updatedAt,
    updatedAt: input.event.updatedAt,
  };
  next.calibrationScore = recomputeRadarCalibrationScore(next);
  return next;
}

export function normalizeRadarControlSettings(
  row: Partial<RadarControlSettingsRecord> | null | undefined,
  now: string
): RadarControlSettingsRecord {
  return {
    ...DEFAULT_RADAR_CONTROL_SETTINGS,
    ...(row ?? {}),
    disabledDomainIds: [...(row?.disabledDomainIds ?? DEFAULT_RADAR_CONTROL_SETTINGS.disabledDomainIds)],
    disabledSourceTiers: [...(row?.disabledSourceTiers ?? DEFAULT_RADAR_CONTROL_SETTINGS.disabledSourceTiers)],
    updatedAt: row?.updatedAt ?? now,
  };
}

export function isTier3OnlyEvent(event: RadarEventRecord): boolean {
  return event.sourceMix.sourceTiers.length > 0 && event.sourceMix.sourceTiers.every((tier) => tier === 'tier_3');
}

export function chooseBlockedExecutionMode(
  current: RadarExecutionMode,
  decision: RadarPromotionDecision,
  sourceTiers: RadarSourceTier[]
): RadarExecutionMode {
  if (decision === 'ignore' || decision === 'watch') return 'watch_only';
  if (decision === 'dossier') return 'dossier_only';
  if (decision === 'action') return 'proposal_auto';
  return sourceTiers.includes('tier_3') ? 'proposal_auto' : current;
}
