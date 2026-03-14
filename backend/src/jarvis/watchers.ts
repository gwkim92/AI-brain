import type { NotificationService } from '../notifications/proactive';
import type {
  ActionProposalRecord,
  BriefingRecord,
  DossierRecord,
  JarvisSessionIntent,
  JarvisSessionRecord,
  JarvisStore,
  JarvisWorkspacePreset,
  WatcherKind,
  WatcherRecord,
  WatcherRunRecord
} from '../store/types';
import { buildDossierWorldModel, buildWorldModelBlockFromExtraction, type DossierWorldModelBlock } from '../world-model/dossier';
import { buildWorldModelDelta, type WorldModelDelta } from '../world-model/delta';
import { recordWorldModelProjectionOutcomes } from '../world-model/outcomes';
import { persistWorldModelProjection } from '../world-model/persistence';

import { generateResearchArtifact } from './research';
import { resolveJarvisMemoryContext } from './memory-context';
import { syncJarvisSessionFromStages } from './stages';

export type WatcherExecutionResult = {
  run: WatcherRunRecord | null;
  briefing: BriefingRecord;
  dossier: DossierRecord;
  followUp: {
    session: JarvisSessionRecord;
    actionProposal: ActionProposalRecord | null;
    changeClass: WatcherFollowUpChangeClass;
    severity: 'info' | 'warning' | 'critical';
    summary: string;
    score: number;
    reasons: string[];
    worldModelDelta: WorldModelDelta | null;
  } | null;
};

export type WatcherFollowUpChangeClass =
  | 'new_high_significance_item'
  | 'official_update'
  | 'policy_change'
  | 'market_shift'
  | 'repo_release'
  | 'health_regression'
  | 'routine_refresh';

type WatcherFollowUpDecision = {
  changeClass: WatcherFollowUpChangeClass;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  proposalTitle: string | null;
  proposalSummary: string | null;
  score: number;
  reasons: string[];
  worldModelDelta: WorldModelDelta | null;
};

type WatcherNotificationPolicy = {
  emitWatcherHit: boolean;
  emitBriefingReady: boolean;
  watcherDedupeWindowMs: number;
  briefingDedupeWindowMs: number;
};

function resolveWatcherFollowUpSeverity(input: {
  changeClass: WatcherFollowUpChangeClass;
  score: number;
  reasons: string[];
  qualityWarning: boolean;
  conflictCount: number;
}): 'info' | 'warning' | 'critical' {
  const hasEscalationSignal =
    input.reasons.includes('health_regression_signal') ||
    input.reasons.includes('effective_date_signal') ||
    input.reasons.includes('official_source_signal') ||
    input.reasons.includes('high_significance_signal') ||
    input.reasons.includes('release_signal');

  if (input.changeClass === 'routine_refresh') {
    return input.qualityWarning || input.conflictCount > 0 ? 'warning' : 'info';
  }

  if (input.reasons.includes('health_regression_signal')) {
    return input.score >= 46 ? 'critical' : 'warning';
  }

  if (hasEscalationSignal && input.score >= 58) {
    return 'critical';
  }

  if (input.score >= 40 || input.qualityWarning || input.conflictCount > 0) {
    return 'warning';
  }

  return 'info';
}

function truncateText(value: string, maxLength = 96): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function normalizeSummary(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-zA-Z가-힣]+/gu, ' ')
    .trim();
}

function hasMeaningfulChange(previousSummary: string | null | undefined, nextSummary: string): boolean {
  const previous = normalizeSummary(previousSummary);
  const next = normalizeSummary(nextSummary);
  if (!previous) return true;
  if (!next) return false;
  return previous !== next;
}

function resolveWatcherIntent(input: { kind: WatcherKind; researchProfile: string | null }): JarvisSessionIntent {
  if (input.kind === 'market' || input.researchProfile === 'market_research') return 'finance';
  if (
    input.kind === 'war_region' ||
    input.researchProfile === 'broad_news' ||
    input.researchProfile === 'topic_news'
  ) {
    return 'news';
  }
  if (input.kind === 'task_health' || input.kind === 'mission_health' || input.kind === 'approval_backlog') {
    return 'general';
  }
  return 'research';
}

function resolveWatcherWorkspacePreset(intent: JarvisSessionIntent, kind: WatcherKind): JarvisWorkspacePreset {
  if (kind === 'task_health' || kind === 'mission_health' || kind === 'approval_backlog') return 'control';
  if (intent === 'finance' || intent === 'news' || intent === 'research' || intent === 'council') return 'research';
  return 'jarvis';
}

function buildWatcherResearchMemoryContent(input: {
  watcher: WatcherRecord;
  summary: string;
  researchProfile: string | null;
  changeClass: WatcherFollowUpChangeClass;
  warningCodes: string[];
}): string {
  const lines = [
    `Watcher: ${input.watcher.title}`,
    `Query: ${input.watcher.query}`,
    `Research profile: ${input.researchProfile ?? 'unknown'}`,
    `Change class: ${input.changeClass}`,
    `Summary: ${input.summary}`
  ];
  if (input.warningCodes.length > 0) {
    lines.push(`Warnings: ${input.warningCodes.join(', ')}`);
  }
  return lines.join('\n');
}

function describeWatcherReason(reason: string): string {
  switch (reason) {
    case 'summary_changed':
      return 'summary updated';
    case 'quality_warning':
      return 'quality warning';
    case 'conflict_signal':
      return 'conflicting evidence';
    case 'high_significance_signal':
      return 'high-significance item';
    case 'major_publisher_signal':
      return 'major publisher';
    case 'official_source_signal':
      return 'official source';
    case 'effective_date_signal':
      return 'effective date';
    case 'release_signal':
      return 'release note';
    case 'health_regression_signal':
      return 'health regression';
    case 'state_acceleration':
      return 'state acceleration';
    case 'primary_hypothesis_shift':
      return 'primary hypothesis shift';
    case 'counter_hypothesis_shift':
      return 'counter hypothesis shift';
    case 'invalidation_hit':
      return 'invalidation hit';
    case 'bottleneck_shift':
      return 'bottleneck shift';
    default:
      return reason.replaceAll('_', ' ');
  }
}

async function resolvePreviousWatcherWorldModel(
  store: JarvisStore,
  watcher: WatcherRecord,
  currentRunId: string
): Promise<DossierWorldModelBlock | null> {
  const previousRun = (await store.listWatcherRuns({ userId: watcher.userId, watcherId: watcher.id, limit: 6 }))
    .filter((item) => item.id !== currentRunId && item.status === 'completed' && item.dossierId)
    .find((item) => Boolean(item.dossierId));
  if (!previousRun?.dossierId) return null;
  const dossier = await store.getDossierById({ userId: watcher.userId, dossierId: previousRun.dossierId });
  if (!dossier) return null;
  const [sources, claims] = await Promise.all([
    store.listDossierSources({ userId: watcher.userId, dossierId: dossier.id, limit: 100 }),
    store.listDossierClaims({ userId: watcher.userId, dossierId: dossier.id, limit: 100 }),
  ]);
  return buildDossierWorldModel({
    dossier,
    sources,
    claims,
  });
}

async function resolvePreviousWatcherRun(
  store: JarvisStore,
  watcher: WatcherRecord,
  currentRunId: string
): Promise<WatcherRunRecord | null> {
  return (
    (await store.listWatcherRuns({ userId: watcher.userId, watcherId: watcher.id, limit: 6 }))
      .filter((item) => item.id !== currentRunId && item.status === 'completed' && item.dossierId)
      .find((item) => Boolean(item.dossierId)) ?? null
  );
}

export function resolveWatcherNotificationPolicy(input: {
  monitoringPreference?: 'manual' | 'important_changes' | 'all_changes' | null;
  changeClass: WatcherFollowUpChangeClass;
  severity: 'info' | 'warning' | 'critical';
  qualityWarning: boolean;
}): WatcherNotificationPolicy {
  const preference = input.monitoringPreference ?? 'important_changes';

  if (preference === 'manual') {
    const emit = input.severity !== 'info' || input.qualityWarning;
    return {
      emitWatcherHit: emit,
      emitBriefingReady: emit,
      watcherDedupeWindowMs: 5 * 60_000,
      briefingDedupeWindowMs: 5 * 60_000
    };
  }

  if (preference === 'all_changes') {
    return {
      emitWatcherHit: true,
      emitBriefingReady: true,
      watcherDedupeWindowMs: 15_000,
      briefingDedupeWindowMs: 20_000
    };
  }

  return {
    emitWatcherHit: input.changeClass !== 'routine_refresh' || input.qualityWarning,
    emitBriefingReady: true,
    watcherDedupeWindowMs: 60_000,
    briefingDedupeWindowMs: 60_000
  };
}

export function buildWatcherFollowUpDecision(input: {
  watcher: WatcherRecord;
  summary: string;
  previousSummary: string | null;
  quality: Record<string, unknown>;
  conflictCount: number;
  researchProfile: string | null;
  monitoringPreference?: 'manual' | 'important_changes' | 'all_changes' | null;
  worldModelDelta?: WorldModelDelta | null;
}): WatcherFollowUpDecision {
  const qualityDimensions =
    input.quality.quality_dimensions && typeof input.quality.quality_dimensions === 'object' && !Array.isArray(input.quality.quality_dimensions)
      ? (input.quality.quality_dimensions as Record<string, unknown>)
      : {};
  const qualityWarning = input.quality.quality_gate_passed === false;
  const summaryChanged = hasMeaningfulChange(input.previousSummary, input.summary);
  const worldModelDelta = input.worldModelDelta ?? null;
  const structuralShift = worldModelDelta?.hasMeaningfulShift === true;
  const releaseCount = Number(qualityDimensions.release_source_count ?? 0);
  const officialCount = Number(qualityDimensions.official_source_count ?? 0);
  const effectiveDateCount = Number(qualityDimensions.effective_date_source_count ?? 0);
  const highSignificanceHeadlineCount = Number(qualityDimensions.high_significance_headline_count ?? 0);
  const majorPublisherCount = Number(qualityDimensions.major_publisher_count ?? 0);
  const healthRegressionPattern = /(fail|failure|failing|error|incident|regression|flaky|blocked|stale|degrad|outage|불안정|실패|차단|정체|장애)/iu;
  const hasHealthRegression = healthRegressionPattern.test(input.summary);
  const reasons: string[] = [];
  let score = 0;

  if (summaryChanged) {
    score += 24;
    reasons.push('summary_changed');
  }
  if (qualityWarning) {
    score += 6;
    reasons.push('quality_warning');
  }
  if (input.conflictCount > 0) {
    score += Math.min(input.conflictCount, 2) * 6;
    reasons.push('conflict_signal');
  }
  if (highSignificanceHeadlineCount > 0) {
    score += Math.min(highSignificanceHeadlineCount, 3) * 8;
    reasons.push('high_significance_signal');
  }
  if (majorPublisherCount > 0) {
    score += Math.min(majorPublisherCount, 3) * 4;
    reasons.push('major_publisher_signal');
  }
  if (officialCount > 0) {
    score += Math.min(officialCount, 3) * 10;
    reasons.push('official_source_signal');
  }
  if (effectiveDateCount > 0) {
    score += Math.min(effectiveDateCount, 2) * 12;
    reasons.push('effective_date_signal');
  }
  if (releaseCount > 0) {
    score += Math.min(releaseCount, 2) * 12;
    reasons.push('release_signal');
  }
  if (hasHealthRegression) {
    score += 36;
    reasons.push('health_regression_signal');
  }
  if (worldModelDelta?.reasons.includes('state_acceleration')) {
    score += 12;
    reasons.push('state_acceleration');
  }
  if (worldModelDelta?.reasons.includes('primary_hypothesis_shift')) {
    score += 14;
    reasons.push('primary_hypothesis_shift');
  }
  if (worldModelDelta?.reasons.includes('counter_hypothesis_shift')) {
    score += 8;
    reasons.push('counter_hypothesis_shift');
  }
  if (worldModelDelta?.reasons.includes('invalidation_hit')) {
    score += 16;
    reasons.push('invalidation_hit');
  }
  if (worldModelDelta?.reasons.includes('bottleneck_shift')) {
    score += 10;
    reasons.push('bottleneck_shift');
  }

  let changeClass: WatcherFollowUpChangeClass = 'routine_refresh';
  if (
    input.watcher.kind === 'task_health' ||
    input.watcher.kind === 'mission_health' ||
    input.watcher.kind === 'approval_backlog' ||
    (input.watcher.kind === 'repo' && hasHealthRegression)
  ) {
    changeClass = 'health_regression';
  } else if ((input.researchProfile === 'policy_regulation' || effectiveDateCount > 0) && (summaryChanged || structuralShift)) {
    changeClass = 'policy_change';
  } else if (input.watcher.kind === 'repo' && releaseCount > 0 && (summaryChanged || structuralShift)) {
    changeClass = 'repo_release';
  } else if ((input.watcher.kind === 'market' || input.researchProfile === 'market_research') && (summaryChanged || structuralShift)) {
    changeClass = 'market_shift';
  } else if (input.watcher.kind === 'company' && officialCount > 0 && (summaryChanged || structuralShift)) {
    changeClass = 'official_update';
  } else if ((highSignificanceHeadlineCount > 0 || input.conflictCount > 0 || structuralShift) && (summaryChanged || structuralShift)) {
    changeClass = 'new_high_significance_item';
  }

  const followUpThresholdByClass: Record<Exclude<WatcherFollowUpChangeClass, 'routine_refresh'>, number> = {
    new_high_significance_item: 40,
    official_update: 44,
    policy_change: 42,
    market_shift: 40,
    repo_release: 40,
    health_regression: 46
  };

  const monitoringPreference = input.monitoringPreference ?? 'important_changes';
  const thresholdAdjustment =
    monitoringPreference === 'all_changes' ? -10 : monitoringPreference === 'manual' ? 12 : 0;

  if (
    changeClass !== 'routine_refresh' &&
    score < Math.max(28, followUpThresholdByClass[changeClass] + thresholdAdjustment)
  ) {
    changeClass = 'routine_refresh';
  }

  let severity = resolveWatcherFollowUpSeverity({
    changeClass,
    score,
    reasons,
    qualityWarning,
    conflictCount: input.conflictCount
  });

  if (monitoringPreference === 'manual' && changeClass !== 'routine_refresh' && severity !== 'critical') {
    changeClass = 'routine_refresh';
    severity = resolveWatcherFollowUpSeverity({
      changeClass,
      score,
      reasons,
      qualityWarning,
      conflictCount: input.conflictCount
    });
  }

  const summaryByClass: Record<WatcherFollowUpChangeClass, string> = {
    new_high_significance_item: '중요한 새 변화가 감지되었습니다.',
    official_update: '공식 업데이트가 감지되었습니다.',
    policy_change: '정책 또는 규제 변화가 감지되었습니다.',
    market_shift: structuralShift ? '시장 구조 가설 변화가 감지되었습니다.' : '시장 변화 신호가 감지되었습니다.',
    repo_release: '레포 릴리즈 또는 변경 이력이 감지되었습니다.',
    health_regression: '운영 상태 저하 또는 회귀 신호가 감지되었습니다.',
    routine_refresh: '모니터가 최신 근거로 브리프를 새로 고쳤습니다.'
  };

  const proposalByClass: Record<
    Exclude<WatcherFollowUpChangeClass, 'routine_refresh'>,
    { title: string; summary: string }
  > = {
    new_high_significance_item: {
      title: '모니터 변화 검토',
      summary: '새로 감지된 변화가 실제 후속 대응이 필요한지 브리프를 검토하세요.'
    },
    official_update: {
      title: '공식 업데이트 검토',
      summary: '공식 소스 기반 업데이트가 감지되었습니다. 후속 조사나 공유가 필요한지 검토하세요.'
    },
    policy_change: {
      title: '정책 변화 검토',
      summary: '정책 또는 규제 변화가 감지되었습니다. 영향 범위를 검토하고 후속 대응 여부를 결정하세요.'
    },
    market_shift: {
      title: '시장 변화 검토',
      summary: '시장 변화 신호가 감지되었습니다. 브리프를 검토하고 후속 분석 또는 알림 확대 여부를 결정하세요.'
    },
    repo_release: {
      title: '레포 업데이트 검토',
      summary: '릴리즈 또는 변경 이력이 감지되었습니다. 레포 브리프를 검토하고 follow-up 조사를 결정하세요.'
    },
    health_regression: {
      title: '운영 이상 징후 검토',
      summary: '운영 상태 저하 또는 회귀 신호가 감지되었습니다. 즉시 점검이 필요한지 검토하세요.'
    }
  };

  const proposal = changeClass === 'routine_refresh' || severity === 'info' ? null : proposalByClass[changeClass];

  return {
    changeClass,
    severity,
    summary: summaryByClass[changeClass],
    proposalTitle: proposal?.title ?? null,
    proposalSummary: proposal?.summary ?? null,
    score,
    reasons,
    worldModelDelta
  };
}

function buildWatcherNotificationMessage(input: {
  change: WatcherFollowUpDecision;
  qualityWarning: boolean;
  sourceCount: number;
}): string {
  if (input.qualityWarning) {
    return `${input.sourceCount} source(s) compiled with quality warnings.`;
  }
  const highlightedSignals = input.change.reasons
    .filter((reason) => reason !== 'summary_changed')
    .slice(0, 2)
    .map(describeWatcherReason)
    .join(', ');
  if (!highlightedSignals) {
    return input.change.summary;
  }
  return `${input.change.summary} (score: ${input.change.score}; signals: ${highlightedSignals})`;
}

async function resolvePreviousWatcherSummary(store: JarvisStore, watcher: WatcherRecord, currentRunId: string): Promise<string | null> {
  const previousRun = (await store.listWatcherRuns({ userId: watcher.userId, watcherId: watcher.id, limit: 6 }))
    .filter((item) => item.id !== currentRunId && item.status === 'completed')
    .find((item) => item.summary?.trim().length > 0 || item.briefingId || item.dossierId);
  if (!previousRun) return null;
  if (previousRun.summary?.trim()) {
    return previousRun.summary.trim();
  }
  if (previousRun.briefingId) {
    const briefing = await store.getBriefingById({ userId: watcher.userId, briefingId: previousRun.briefingId });
    if (briefing?.summary?.trim()) return briefing.summary.trim();
  }
  if (previousRun.dossierId) {
    const dossier = await store.getDossierById({ userId: watcher.userId, dossierId: previousRun.dossierId });
    if (dossier?.summary?.trim()) return dossier.summary.trim();
  }
  return null;
}

async function createWatcherFollowUpSession(input: {
  store: JarvisStore;
  watcher: WatcherRecord;
  run: WatcherRunRecord;
  briefing: BriefingRecord;
  dossier: DossierRecord;
  change: WatcherFollowUpDecision;
  researchProfile: string | null;
  profileReasons: string[];
  formatHint: string | null;
  warningCodes: string[];
  qualityMode: 'pass' | 'warn' | 'block' | null;
  qualityDimensions: Record<string, unknown>;
  notificationService?: NotificationService;
}): Promise<{ session: JarvisSessionRecord; actionProposal: ActionProposalRecord | null }> {
  const {
    store,
    watcher,
    run,
    briefing,
    dossier,
    change,
    researchProfile,
    profileReasons,
    formatHint,
    warningCodes,
    qualityMode,
    qualityDimensions,
    notificationService
  } = input;

  const intent = resolveWatcherIntent({ kind: watcher.kind, researchProfile });
  const workspacePreset = resolveWatcherWorkspacePreset(intent, watcher.kind);
  const session = await store.createJarvisSession({
    userId: watcher.userId,
    title: truncateText(`모니터 업데이트: ${watcher.title}`, 96),
    prompt: watcher.query,
    source: 'watcher',
    intent,
    status: 'running',
    workspacePreset,
    primaryTarget: 'dossier',
    briefingId: briefing.id,
    dossierId: dossier.id
  });

  let actionProposal: ActionProposalRecord | null = null;
  if (change.proposalTitle && change.proposalSummary) {
    actionProposal = await store.createActionProposal({
      userId: watcher.userId,
      sessionId: session.id,
      kind: 'custom',
      title: change.proposalTitle,
      summary: change.proposalSummary,
      payload: {
        watcher_id: watcher.id,
        run_id: run.id,
        briefing_id: briefing.id,
        dossier_id: dossier.id,
        change_class: change.changeClass,
        severity: change.severity,
        research_profile: researchProfile,
        warning_codes: warningCodes,
        change_score: change.score,
        change_reasons: change.reasons,
        world_model_delta: change.worldModelDelta
      }
    });
    notificationService?.emitActionProposalReady(session.id, actionProposal.id, actionProposal.title, {
      severity: change.severity,
      message: `${actionProposal.summary} (score: ${change.score})`
    });
  }

  await store.upsertJarvisSessionStage({
    userId: watcher.userId,
    sessionId: session.id,
    stageKey: 'research',
    capability: 'research',
    title: 'Monitor refresh',
    status: 'completed',
    orderIndex: 0,
    artifactRefsJson: {
      watcher_id: watcher.id,
      watcher_run_id: run.id,
      research_profile: researchProfile,
      profile_reasons: profileReasons,
      quality_mode: qualityMode,
      warning_codes: warningCodes,
      quality_dimensions: qualityDimensions,
      format_hint: formatHint,
      change_class: change.changeClass,
      change_severity: change.severity,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    },
    summary: change.summary,
    completedAt: new Date().toISOString()
  });
  await store.upsertJarvisSessionStage({
    userId: watcher.userId,
    sessionId: session.id,
    stageKey: 'brief',
    capability: 'brief',
    title: 'Updated brief',
    status: 'completed',
    orderIndex: 1,
    dependsOnJson: ['research'],
    artifactRefsJson: {
      briefing_id: briefing.id,
      dossier_id: dossier.id,
      research_profile: researchProfile,
      profile_reasons: profileReasons,
      quality_mode: qualityMode,
      warning_codes: warningCodes,
      quality_dimensions: qualityDimensions,
      format_hint: formatHint,
      change_class: change.changeClass,
      change_severity: change.severity,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    },
    summary: briefing.summary,
    completedAt: new Date().toISOString()
  });
  await store.upsertJarvisSessionStage({
    userId: watcher.userId,
    sessionId: session.id,
    stageKey: 'monitor',
    capability: 'monitor',
    title: 'Change detection',
    status: 'completed',
    orderIndex: 2,
    dependsOnJson: ['brief'],
    artifactRefsJson: {
      watcher_id: watcher.id,
      watcher_run_id: run.id,
      change_class: change.changeClass,
      change_severity: change.severity,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    },
    summary: change.summary,
    completedAt: new Date().toISOString()
  });
  await store.upsertJarvisSessionStage({
    userId: watcher.userId,
    sessionId: session.id,
    stageKey: 'notify',
    capability: 'notify',
    title: 'Follow-up notice',
    status: 'completed',
    orderIndex: 3,
    dependsOnJson: ['monitor'],
    artifactRefsJson: {
      watcher_id: watcher.id,
      briefing_id: briefing.id,
      dossier_id: dossier.id,
      change_class: change.changeClass,
      change_severity: change.severity,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    },
    summary: 'Monitor change surfaced through notifications',
    completedAt: new Date().toISOString()
  });
  if (actionProposal) {
    await store.upsertJarvisSessionStage({
      userId: watcher.userId,
      sessionId: session.id,
      stageKey: 'approve',
      capability: 'approve',
      title: 'Follow-up review',
      status: 'needs_approval',
      orderIndex: 4,
      dependsOnJson: ['notify'],
      artifactRefsJson: {
        action_proposal_id: actionProposal.id,
        change_class: change.changeClass,
        change_severity: change.severity,
        change_score: change.score,
        change_reasons: change.reasons,
        world_model_delta: change.worldModelDelta
      },
      summary: actionProposal.title
    });
  }

  await store.appendJarvisSessionEvent({
    userId: watcher.userId,
    sessionId: session.id,
    eventType: 'session.created',
    status: actionProposal ? 'needs_approval' : 'completed',
    summary: 'Monitor update session created',
    data: {
      source: 'watcher',
      watcher_id: watcher.id,
      watcher_run_id: run.id,
      intent,
      research_profile: researchProfile,
      change_class: change.changeClass,
      severity: change.severity,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    }
  });
  await store.appendJarvisSessionEvent({
    userId: watcher.userId,
    sessionId: session.id,
    eventType: 'watcher.change.detected',
    status: actionProposal ? 'needs_approval' : 'completed',
    summary: change.summary,
    data: {
      watcher_id: watcher.id,
      watcher_run_id: run.id,
      change_class: change.changeClass,
      severity: change.severity,
      research_profile: researchProfile,
      warning_codes: warningCodes,
      change_score: change.score,
      change_reasons: change.reasons,
      world_model_delta: change.worldModelDelta
    }
  });
  if (actionProposal) {
    await store.appendJarvisSessionEvent({
      userId: watcher.userId,
      sessionId: session.id,
      eventType: 'watcher.follow_up.suggested',
      status: 'needs_approval',
      summary: actionProposal.title,
      data: {
        action_proposal_id: actionProposal.id,
        change_class: change.changeClass,
        severity: change.severity
      }
    });
  }

  const synced = await syncJarvisSessionFromStages(store, {
    userId: watcher.userId,
    sessionId: session.id
  });
  const finalSession = synced?.session ?? session;
  await store.createMemoryNote({
    userId: watcher.userId,
    kind: 'research_memory',
    title: truncateText(`Monitor: ${watcher.title}`, 88),
    content: buildWatcherResearchMemoryContent({
      watcher,
      summary: change.summary,
      researchProfile,
      changeClass: change.changeClass,
      warningCodes
    }),
    tags: ['monitor', change.changeClass, researchProfile ?? 'unknown'].slice(0, 8),
    pinned: false,
    source: 'session',
    relatedSessionId: finalSession.id,
    relatedTaskId: finalSession.taskId ?? null
  });
  return {
    session: finalSession,
    actionProposal
  };
}

export function resolveWatcherPollMinutes(watcher: WatcherRecord): number {
  const raw = watcher.configJson?.poll_minutes;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return 60;
  }
  return Math.max(5, Math.min(24 * 60, Math.trunc(value)));
}

export function shouldRunWatcherNow(watcher: WatcherRecord, now: Date): boolean {
  if (watcher.status !== 'active') return false;
  if (!watcher.lastRunAt) return true;
  const lastRunMs = Date.parse(watcher.lastRunAt);
  if (!Number.isFinite(lastRunMs)) return true;
  const nextRunMs = lastRunMs + resolveWatcherPollMinutes(watcher) * 60_000;
  return now.getTime() >= nextRunMs;
}

export async function executeWatcherRun(input: {
  store: JarvisStore;
  watcher: WatcherRecord;
  run: WatcherRunRecord;
  notificationService?: NotificationService;
}): Promise<WatcherExecutionResult> {
  const { store, watcher, run, notificationService } = input;
  const nowIso = new Date().toISOString();

  try {
    const previousSummary = await resolvePreviousWatcherSummary(store, watcher, run.id);
    const previousWorldModel = await resolvePreviousWatcherWorldModel(store, watcher, run.id);
    const previousRun = await resolvePreviousWatcherRun(store, watcher, run.id);
    const memoryContext = await resolveJarvisMemoryContext(store, {
      userId: watcher.userId,
      prompt: watcher.query,
      limit: 4
    });
    const monitoringPreference = memoryContext?.preferences?.monitoringPreference ?? null;
    const artifact = await generateResearchArtifact(watcher.query, {
      strictness:
        watcher.kind === 'external_topic' ||
        watcher.kind === 'company' ||
        watcher.kind === 'market' ||
        watcher.kind === 'war_region'
          ? 'news'
          : 'default',
      intent: resolveWatcherIntent({ kind: watcher.kind, researchProfile: null }),
      taskType: watcher.kind,
    });
    const currentWorldModel = buildWorldModelBlockFromExtraction({
      extraction: artifact.worldModelExtraction,
      now: nowIso,
    });
    const worldModelDelta = buildWorldModelDelta({
      previous: previousWorldModel,
      current: currentWorldModel,
    });
    if (previousRun?.dossierId) {
      await recordWorldModelProjectionOutcomes({
        store,
        userId: watcher.userId,
        dossierId: previousRun.dossierId,
        extraction: artifact.worldModelExtraction,
        evaluatedAt: nowIso,
        now: nowIso,
      });
    }
    const change = buildWatcherFollowUpDecision({
      watcher,
      summary: artifact.summary,
      previousSummary,
      quality: artifact.quality,
      conflictCount: Number(artifact.conflicts.count ?? 0),
      researchProfile: artifact.researchProfile,
      monitoringPreference,
      worldModelDelta
    });
    const briefing = await store.createBriefing({
      userId: watcher.userId,
      watcherId: watcher.id,
      sessionId: null,
      type: 'on_change',
      status: 'completed',
      title: artifact.title,
      query: watcher.query,
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      sourceCount: artifact.sources.length,
      qualityJson: artifact.quality
    });
    const dossier = await store.createDossier({
      userId: watcher.userId,
      sessionId: null,
      briefingId: briefing.id,
      title: artifact.title,
      query: watcher.query,
      status: 'ready',
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      qualityJson: artifact.quality,
      conflictsJson: artifact.conflicts
    });
    await store.replaceDossierSources({ userId: watcher.userId, dossierId: dossier.id, sources: artifact.sources });
    await store.replaceDossierClaims({ userId: watcher.userId, dossierId: dossier.id, claims: artifact.claims });
    await persistWorldModelProjection({
      store,
      userId: watcher.userId,
      dossierId: dossier.id,
      briefingId: briefing.id,
      watcherId: watcher.id,
      extraction: artifact.worldModelExtraction,
      origin: 'watcher_run',
      snapshotTarget: {
        targetType: 'dossier',
        targetId: dossier.id,
      },
      now: nowIso,
    });
    const qualityDimensions: Record<string, unknown> =
      artifact.quality.quality_dimensions &&
      typeof artifact.quality.quality_dimensions === 'object' &&
      !Array.isArray(artifact.quality.quality_dimensions)
        ? { ...(artifact.quality.quality_dimensions as Record<string, unknown>) }
        : {};
    // Routine refreshes should update the brief/notifications without opening a new proactive session.
    // Otherwise the UI accumulates noisy sessions for "no material change" refresh cycles.
    const shouldCreateFollowUpSession = change.changeClass !== 'routine_refresh';
    const followUp = shouldCreateFollowUpSession
      ? await createWatcherFollowUpSession({
          store,
          watcher,
          run,
          briefing,
          dossier,
          change,
          researchProfile: artifact.researchProfile,
          profileReasons: artifact.profileReasons,
          formatHint: artifact.formatHint,
          warningCodes:
            Array.isArray(artifact.quality.soft_warning_codes)
              ? artifact.quality.soft_warning_codes.filter((value): value is string => typeof value === 'string')
              : [],
          qualityMode: artifact.qualityMode,
          qualityDimensions,
          notificationService
        })
      : null;
    if (followUp) {
      await store.updateJarvisSession({
        sessionId: followUp.session.id,
        userId: watcher.userId,
        briefingId: briefing.id,
        dossierId: dossier.id
      });
    }
    const updatedRun = await store.updateWatcherRun({
      runId: run.id,
      userId: watcher.userId,
      status: 'completed',
      summary: artifact.summary,
      briefingId: briefing.id,
      dossierId: dossier.id,
      error: null
    });
    await store.updateWatcher({
      watcherId: watcher.id,
      userId: watcher.userId,
      status: 'active',
      lastRunAt: nowIso,
      lastHitAt: nowIso
    });
    const qualityWarning = artifact.quality.quality_gate_passed === false || Number(artifact.conflicts.count ?? 0) > 0;
    const notificationPolicy = resolveWatcherNotificationPolicy({
      monitoringPreference,
      changeClass: change.changeClass,
      severity: change.severity,
      qualityWarning
    });
    const notificationMessage = buildWatcherNotificationMessage({
      change,
      qualityWarning,
      sourceCount: artifact.sources.length
    });
    if (notificationPolicy.emitWatcherHit) {
      notificationService?.emitWatcherHit(watcher.id, watcher.title, notificationMessage, dossier.id, {
        severity: change.severity,
        dedupeWindowMs: notificationPolicy.watcherDedupeWindowMs
      });
    }
    if (notificationPolicy.emitBriefingReady) {
      notificationService?.emitBriefingReady(briefing.id, artifact.title, artifact.sources.length, dossier.id, {
        severity: change.severity,
        message: notificationMessage,
        dedupeWindowMs: notificationPolicy.briefingDedupeWindowMs
      });
    }
    return {
      run: updatedRun,
      briefing,
      dossier,
      followUp: followUp
        ? {
            session: followUp.session,
            actionProposal: followUp.actionProposal,
            changeClass: change.changeClass,
            severity: change.severity,
            summary: change.summary,
            score: change.score,
            reasons: change.reasons,
            worldModelDelta: change.worldModelDelta
          }
        : null
    };
  } catch (error) {
    await store.updateWatcherRun({
      runId: run.id,
      userId: watcher.userId,
      status: 'failed',
      summary: 'Watcher run failed',
      error: error instanceof Error ? error.message : 'failed'
    });
    await store.updateWatcher({
      watcherId: watcher.id,
      userId: watcher.userId,
      status: 'error',
      lastRunAt: nowIso
    });
    throw error;
  }
}
