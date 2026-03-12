import type { NotificationService } from '../notifications/proactive';
import type {
  JarvisStore,
  RadarAutonomyDecisionRecord,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarItemRecord,
  RadarRecommendationRecord,
} from '../store/types';

import { promoteRadarRecommendation, type RadarPromotionResult } from './promotions';

type PromotionStore = Pick<
  JarvisStore,
  | 'evaluateRadar'
  | 'listRadarItems'
  | 'getRadarEventById'
  | 'listRadarDomainPosteriors'
  | 'getRadarAutonomyDecision'
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

export type RadarPromotionSummary = {
  eventId: string;
  decision: RadarEventRecord['decision'];
  watcherId: string | null;
  briefingId: string | null;
  dossierId: string | null;
  sessionId: string | null;
  actionProposalId: string | null;
  autoExecuted: boolean;
};

export type RadarEvaluationExecutionResult = {
  recommendations: RadarRecommendationRecord[];
  promotions: RadarPromotionSummary[];
};

function mapPromotionSummary(input: {
  event: RadarEventRecord;
  promotion: RadarPromotionResult;
}): RadarPromotionSummary {
  return {
    eventId: input.event.id,
    decision: input.event.overrideDecision ?? input.event.decision,
    watcherId: input.promotion.watcher?.id ?? null,
    briefingId: input.promotion.briefing?.id ?? null,
    dossierId: input.promotion.dossier?.id ?? null,
    sessionId: input.promotion.session?.id ?? null,
    actionProposalId: input.promotion.actionProposal?.id ?? null,
    autoExecuted: input.promotion.autoExecuted,
  };
}

export async function executeRadarEvaluationAndPromotion(input: {
  store: PromotionStore;
  userId: string;
  itemIds: string[];
  notificationService?: NotificationService;
  knownItems?: RadarItemRecord[];
}): Promise<RadarEvaluationExecutionResult> {
  const recommendations = await input.store.evaluateRadar({ itemIds: input.itemIds });
  if (recommendations.length === 0) {
    return {
      recommendations,
      promotions: [],
    };
  }

  const itemPool =
    input.knownItems ??
    (await input.store.listRadarItems({
      limit: Math.max(1000, input.itemIds.length * 8),
    }));
  const itemsById = new Map(itemPool.map((item) => [item.id, item] as const));
  const promotions: RadarPromotionSummary[] = [];

  for (const recommendation of recommendations) {
    if (!recommendation.eventId) {
      continue;
    }

    const [event, domainPosteriors, autonomyDecision] = await Promise.all([
      input.store.getRadarEventById(recommendation.eventId),
      input.store.listRadarDomainPosteriors(recommendation.eventId),
      input.store.getRadarAutonomyDecision(recommendation.eventId),
    ]);
    if (!event || !autonomyDecision) {
      continue;
    }

    const items = event.itemIds
      .map((itemId) => itemsById.get(itemId))
      .filter((item): item is RadarItemRecord => Boolean(item));

    const promotion = await promoteRadarRecommendation({
      store: input.store,
      userId: input.userId,
      event,
      items,
      posteriors: domainPosteriors as RadarDomainPosteriorRecord[],
      autonomyDecision: autonomyDecision as RadarAutonomyDecisionRecord,
      recommendation,
      notificationService: input.notificationService,
    });
    promotions.push(mapPromotionSummary({ event, promotion }));
  }

  return {
    recommendations,
    promotions,
  };
}
