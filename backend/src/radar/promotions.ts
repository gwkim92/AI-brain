import type { NotificationService } from '../notifications/proactive';
import type {
  ActionProposalRecord,
  BriefingRecord,
  DossierRecord,
  JarvisSessionRecord,
  JarvisStore,
  RadarAutonomyDecisionRecord,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarItemRecord,
  RadarRecommendationRecord,
  WatcherRecord,
} from '../store/types';
import { persistWorldModelProjection } from '../world-model/persistence';

import { getRadarDomainPack } from './domain-packs';
import { buildRadarExecutionPolicy } from './execution-policy';
import { buildWorldModelExtractionFromRadarEvent } from './world-model';

type PromotionStore = Pick<
  JarvisStore,
  | 'listWatchers'
  | 'createWatcher'
  | 'createBriefing'
  | 'createDossier'
  | 'replaceDossierSources'
  | 'replaceDossierClaims'
  | 'createJarvisSession'
  | 'updateJarvisSession'
  | 'appendJarvisSessionEvent'
  | 'upsertJarvisSessionStage'
  | 'createActionProposal'
  | 'decideActionProposal'
  | 'createWorldModelProjection'
  | 'listWorldModelProjections'
  | 'updateWorldModelProjection'
  | 'upsertWorldModelEntity'
  | 'createWorldModelEvent'
  | 'createWorldModelObservation'
  | 'createWorldModelConstraint'
  | 'createWorldModelStateSnapshot'
  | 'createWorldModelHypothesis'
  | 'createWorldModelHypothesisEvidence'
  | 'createWorldModelInvalidationCondition'
>;

export type RadarPromotionResult = {
  watcher: WatcherRecord | null;
  briefing: BriefingRecord | null;
  dossier: DossierRecord | null;
  session: JarvisSessionRecord | null;
  actionProposal: ActionProposalRecord | null;
  autoExecuted: boolean;
};

function buildRadarNarrative(input: {
  event: RadarEventRecord;
  posteriors: RadarDomainPosteriorRecord[];
  autonomyDecision: RadarAutonomyDecisionRecord;
}): string {
  const domains = input.posteriors.map((posterior) => `- ${posterior.domainId}: ${posterior.score.toFixed(2)}`).join('\n');
  const signals = input.event.expectedNextSignals.map((signal) => `- ${signal}`).join('\n');
  return [
    `## Event`,
    input.event.summary,
    '',
    `## Domain Posterior`,
    domains || '- none',
    '',
    `## Structurality`,
    `- structurality: ${input.event.structuralityScore.toFixed(2)}`,
    `- actionability: ${input.event.actionabilityScore.toFixed(2)}`,
    `- decision: ${input.event.overrideDecision ?? input.event.decision}`,
    '',
    `## Next Signals`,
    signals || '- none',
    '',
    `## Autonomy`,
    `- execution_mode: ${input.autonomyDecision.executionMode}`,
    `- risk_band: ${input.autonomyDecision.riskBand}`,
  ].join('\n');
}

async function ensureRadarWatcher(input: {
  store: PromotionStore;
  userId: string;
  event: RadarEventRecord;
  query: string;
  watcherKind: WatcherRecord['kind'];
}): Promise<WatcherRecord> {
  const existing = await input.store.listWatchers({
    userId: input.userId,
    status: 'active',
    limit: 100,
  });
  const match = existing.find((watcher) => watcher.query === input.query || watcher.title === input.event.title);
  if (match) return match;
  return input.store.createWatcher({
    userId: input.userId,
    kind: input.watcherKind,
    title: input.event.title,
    query: input.query,
    status: 'active',
    configJson: {
      radar_event_id: input.event.id,
      expected_next_signals: input.event.expectedNextSignals,
      promotion_decision: input.event.overrideDecision ?? input.event.decision,
    },
  });
}

export async function promoteRadarRecommendation(input: {
  store: PromotionStore;
  userId: string;
  event: RadarEventRecord;
  items: RadarItemRecord[];
  posteriors: RadarDomainPosteriorRecord[];
  autonomyDecision: RadarAutonomyDecisionRecord;
  recommendation: RadarRecommendationRecord;
  notificationService?: NotificationService;
  now?: string;
}): Promise<RadarPromotionResult> {
  const decision = input.event.overrideDecision ?? input.event.decision;
  const topPack = getRadarDomainPack(input.posteriors[0]?.domainId ?? 'policy_regulation_platform_ai');
  const query = `${input.event.title}\n${input.event.summary}`;
  let watcher: WatcherRecord | null = null;
  let briefing: BriefingRecord | null = null;
  let dossier: DossierRecord | null = null;
  let session: JarvisSessionRecord | null = null;
  let actionProposal: ActionProposalRecord | null = null;
  let autoExecuted = false;

  if (!topPack || decision === 'ignore') {
    return { watcher, briefing, dossier, session, actionProposal, autoExecuted };
  }

  if (decision === 'watch' || decision === 'dossier' || decision === 'action' || decision === 'execute_auto_candidate') {
    watcher = await ensureRadarWatcher({
      store: input.store,
      userId: input.userId,
      event: input.event,
      query,
      watcherKind: topPack.actionMapping.watcherKind,
    });
  }

  let projectionId: string | null = null;

  if (decision === 'dossier' || decision === 'action' || decision === 'execute_auto_candidate') {
    const answerMarkdown = buildRadarNarrative({
      event: input.event,
      posteriors: input.posteriors,
      autonomyDecision: input.autonomyDecision,
    });
    briefing = await input.store.createBriefing({
      userId: input.userId,
      watcherId: watcher?.id ?? null,
      sessionId: null,
      type: 'on_change',
      status: 'completed',
      title: input.event.title,
      query,
      summary: input.event.summary,
      answerMarkdown,
      sourceCount: input.items.length,
      qualityJson: {
        mode: 'pass',
        structurality_score: input.event.structuralityScore,
        actionability_score: input.event.actionabilityScore,
        source_mix: input.event.sourceMix,
      },
    });
    dossier = await input.store.createDossier({
      userId: input.userId,
      sessionId: null,
      briefingId: briefing.id,
      title: input.event.title,
      query,
      status: 'ready',
      summary: input.event.summary,
      answerMarkdown,
      qualityJson: {
        structurality_score: input.event.structuralityScore,
        actionability_score: input.event.actionabilityScore,
      },
      conflictsJson: {
        counter_features: input.posteriors.flatMap((posterior) => posterior.counterFeatures),
      },
    });
    await input.store.replaceDossierSources({
      userId: input.userId,
      dossierId: dossier.id,
      sources: input.items.map((item, index) => ({
        url: item.sourceUrl,
        title: item.title,
        domain: (() => {
          try {
            return new URL(item.sourceUrl).hostname;
          } catch {
            return item.sourceName;
          }
        })(),
        publishedAt: item.publishedAt,
        sourceOrder: index,
      })),
    });
    await input.store.replaceDossierClaims({
      userId: input.userId,
      dossierId: dossier.id,
      claims: input.event.claims.map((claimText, index) => ({
        claimText,
        sourceUrls: input.items.map((item) => item.sourceUrl),
        claimOrder: index,
      })),
    });
    const extraction = buildWorldModelExtractionFromRadarEvent({
      event: input.event,
      items: input.items,
      posteriors: input.posteriors,
      generatedAt: input.now,
    });
    const persisted = await persistWorldModelProjection({
      store: input.store,
      userId: input.userId,
      dossierId: dossier.id,
      briefingId: briefing.id,
      extraction,
      origin: 'dossier_refresh',
      snapshotTarget: {
        targetType: 'dossier',
        targetId: dossier.id,
      },
      now: input.now,
    });
    projectionId = persisted.projection.id;
    const topDomainId = input.posteriors[0]?.domainId ?? null;
    await input.store.updateWorldModelProjection({
      projectionId,
      userId: input.userId,
      summaryJson: {
        ...persisted.projection.summaryJson,
        radar_event_id: input.event.id,
        radar_domain_id: topDomainId,
        radar_execution_mode: input.autonomyDecision.executionMode,
        radar_promotion_decision: decision,
      },
    });
  }

  if (decision === 'action' || decision === 'execute_auto_candidate') {
    session = await input.store.createJarvisSession({
      userId: input.userId,
      title: input.event.title,
      prompt: query,
      source: 'radar',
      intent: topPack.actionMapping.sessionIntent,
      status: input.autonomyDecision.executionMode === 'execute_auto' ? 'running' : 'needs_approval',
      workspacePreset: 'research',
      primaryTarget: dossier ? 'dossier' : 'briefing',
      briefingId: briefing?.id ?? null,
      dossierId: dossier?.id ?? null,
    });
    await input.store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'radar.promoted',
      status: session.status,
      summary: input.event.title,
      data: {
        event_id: input.event.id,
        promotion_decision: decision,
        autonomy_execution_mode: input.autonomyDecision.executionMode,
      },
    });
    await input.store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: session.id,
      stageKey: 'monitor',
      capability: 'monitor',
      title: 'Radar promotion',
      status: 'completed',
      summary: input.event.summary,
      artifactRefsJson: {
        event_id: input.event.id,
        watcher_id: watcher?.id ?? null,
      },
      completedAt: input.now ?? new Date().toISOString(),
    });
    if (briefing) {
      await input.store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: session.id,
        stageKey: 'brief',
        capability: 'brief',
        title: 'Auto brief',
        status: 'completed',
        summary: briefing.summary,
        artifactRefsJson: {
          briefing_id: briefing.id,
          dossier_id: dossier?.id ?? null,
          world_model_projection_id: projectionId,
        },
        completedAt: input.now ?? new Date().toISOString(),
      });
    }
    const executionPolicy = buildRadarExecutionPolicy({
      actionKind: topPack.actionMapping.defaultActionKind,
      payload: {
        radar_event_id: input.event.id,
      },
    });
    actionProposal = await input.store.createActionProposal({
      userId: input.userId,
      sessionId: session.id,
      kind: topPack.actionMapping.defaultActionKind,
      title: `${input.event.title} auto action`,
      summary: `Auto promotion from radar event ${input.event.id}`,
      payload: {
        event_id: input.event.id,
        autonomy_decision: input.autonomyDecision,
        recommendation: input.recommendation,
        watcher_id: watcher?.id ?? null,
        briefing_id: briefing?.id ?? null,
        dossier_id: dossier?.id ?? null,
        world_model_projection_id: projectionId,
        execution_policy: executionPolicy,
      },
    });
    if (
      input.autonomyDecision.executionMode === 'execute_auto' &&
      !input.autonomyDecision.requiresHuman &&
      executionPolicy.mode !== 'blocked'
    ) {
      actionProposal = await input.store.decideActionProposal({
        proposalId: actionProposal.id,
        userId: input.userId,
        decidedBy: input.userId,
        decision: 'approved',
      });
      autoExecuted = true;
      await input.store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: 'radar.action_auto_executed',
        status: 'completed',
        summary: actionProposal?.title ?? `${input.event.title} auto action`,
        data: {
          action_id: actionProposal?.id ?? null,
          execution_mode: input.autonomyDecision.executionMode,
          execution_policy: executionPolicy.mode,
        },
      });
      await input.store.updateJarvisSession({
        sessionId: session.id,
        userId: input.userId,
        status: 'completed',
      });
    } else {
      if (executionPolicy.mode === 'blocked' && session.status === 'running') {
        session = (await input.store.updateJarvisSession({
          sessionId: session.id,
          userId: input.userId,
          status: 'needs_approval',
        })) ?? session;
      }
      input.notificationService?.emitActionProposalReady(session.id, actionProposal.id, actionProposal.title, {
        severity: input.autonomyDecision.executionMode === 'proposal_auto' ? 'warning' : 'info',
        message: `${actionProposal.summary} (${input.autonomyDecision.executionMode})`,
      });
    }
  }

  return { watcher, briefing, dossier, session, actionProposal, autoExecuted };
}
