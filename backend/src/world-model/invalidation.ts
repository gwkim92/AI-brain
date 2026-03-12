import type {
  WorldModelAttributes,
  WorldModelEventKind,
  WorldModelInvalidationConditionRecord,
  WorldModelInvalidationStatus,
  WorldModelSeverity,
} from '../store/types';

import type { WorldModelExtraction } from './schemas';

export type WorldModelInvalidationMode = 'requires_evidence' | 'forbids_evidence';

export type WorldModelInvalidationConditionDraft = {
  description: string;
  expectedBy: string | null;
  severity: WorldModelSeverity;
  mode: WorldModelInvalidationMode;
  watchMetricKeys: string[];
  watchEventKinds: WorldModelEventKind[];
  watchKeywords: string[];
  observedStatus: WorldModelInvalidationStatus;
  matchedEvidence: string[];
};

export type WorldModelInvalidationMatcherAttributes = {
  mode: WorldModelInvalidationMode;
  watchMetricKeys: string[];
  watchEventKinds: WorldModelEventKind[];
  watchKeywords: string[];
};

type InvalidationConditionTemplate = Omit<WorldModelInvalidationConditionDraft, 'observedStatus' | 'matchedEvidence'>;

function isWorldModelInvalidationMode(value: unknown): value is WorldModelInvalidationMode {
  return value === 'requires_evidence' || value === 'forbids_evidence';
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function addDays(value: string, days: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed + days * 24 * 60 * 60 * 1000).toISOString();
}

function conditionMatchesText(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function collectMatchedEvidence(condition: InvalidationConditionTemplate, extraction: WorldModelExtraction): string[] {
  const matchedEvidence: string[] = [];

  for (const observation of extraction.observations) {
    if (condition.watchMetricKeys.includes(observation.metricKey)) {
      matchedEvidence.push(`observation:${observation.metricKey}:${observation.valueText}`);
    }
  }

  for (const event of extraction.events) {
    if (condition.watchEventKinds.includes(event.kind)) {
      matchedEvidence.push(`event:${event.kind}:${event.summary}`);
    }
  }

  if (condition.watchKeywords.length > 0) {
    for (const claim of extraction.claims) {
      if (conditionMatchesText(claim.text, condition.watchKeywords)) {
        matchedEvidence.push(`claim:${claim.text}`);
      }
    }
  }

  return [...new Set(matchedEvidence)];
}

export function buildPendingInvalidationCondition(
  extraction: WorldModelExtraction,
  input: {
    description: string;
    daysUntilCheck: number;
    severity: WorldModelSeverity;
    mode: WorldModelInvalidationMode;
    watchMetricKeys?: string[];
    watchEventKinds?: WorldModelEventKind[];
    watchKeywords?: string[];
  }
): InvalidationConditionTemplate {
  return {
    description: input.description,
    expectedBy: addDays(extraction.generatedAt, input.daysUntilCheck),
    severity: input.severity,
    mode: input.mode,
    watchMetricKeys: [...(input.watchMetricKeys ?? [])],
    watchEventKinds: [...(input.watchEventKinds ?? [])],
    watchKeywords: [...(input.watchKeywords ?? [])],
  };
}

export function buildInvalidationMatcherAttributes(
  condition: Pick<
    WorldModelInvalidationConditionDraft,
    'mode' | 'watchMetricKeys' | 'watchEventKinds' | 'watchKeywords'
  >
): WorldModelAttributes {
  return {
    mode: condition.mode,
    watch_metric_keys: [...condition.watchMetricKeys],
    watch_event_kinds: [...condition.watchEventKinds],
    watch_keywords: [...condition.watchKeywords],
  };
}

function readInvalidationMatcherAttributes(
  attributes: WorldModelAttributes
): WorldModelInvalidationMatcherAttributes | null {
  const mode = attributes.mode;
  const watchMetricKeys = attributes.watch_metric_keys;
  const watchEventKinds = attributes.watch_event_kinds;
  const watchKeywords = attributes.watch_keywords;

  if (
    !isWorldModelInvalidationMode(mode) ||
    !Array.isArray(watchMetricKeys) ||
    !Array.isArray(watchEventKinds) ||
    !Array.isArray(watchKeywords)
  ) {
    return null;
  }

  return {
    mode,
    watchMetricKeys: watchMetricKeys.filter((value): value is string => typeof value === 'string'),
    watchEventKinds: watchEventKinds.filter((value): value is WorldModelEventKind => typeof value === 'string'),
    watchKeywords: watchKeywords.filter((value): value is string => typeof value === 'string'),
  };
}

export function reevaluateStoredInvalidationCondition(input: {
  condition: WorldModelInvalidationConditionRecord;
  extraction: WorldModelExtraction;
  now?: string;
}): { observedStatus: WorldModelInvalidationStatus; matchedEvidence: string[] } {
  const matcher = readInvalidationMatcherAttributes(input.condition.attributes);
  if (!matcher) {
    return {
      observedStatus: input.condition.observedStatus,
      matchedEvidence: [],
    };
  }

  const [reevaluated] = evaluateInvalidationConditions({
    extraction: input.extraction,
    now: input.now,
    conditions: [
      {
        description: input.condition.description,
        expectedBy: input.condition.expectedBy,
        severity: input.condition.severity,
        mode: matcher.mode,
        watchMetricKeys: matcher.watchMetricKeys,
        watchEventKinds: matcher.watchEventKinds,
        watchKeywords: matcher.watchKeywords,
      },
    ],
  });

  return {
    observedStatus: reevaluated?.observedStatus ?? input.condition.observedStatus,
    matchedEvidence: reevaluated?.matchedEvidence ?? [],
  };
}

export function evaluateInvalidationConditions(input: {
  extraction: WorldModelExtraction;
  conditions: InvalidationConditionTemplate[];
  now?: string;
}): WorldModelInvalidationConditionDraft[] {
  const now = input.now ?? input.extraction.generatedAt;

  return input.conditions.map((condition) => {
    const matchedEvidence = collectMatchedEvidence(condition, input.extraction);
    const deadlinePassed =
      condition.expectedBy !== null &&
      Number.isFinite(Date.parse(condition.expectedBy)) &&
      Date.parse(now) >= Date.parse(condition.expectedBy);

    let observedStatus: WorldModelInvalidationStatus = 'pending';
    if (condition.mode === 'requires_evidence') {
      if (matchedEvidence.length > 0) {
        observedStatus = 'missed';
      } else if (deadlinePassed) {
        observedStatus = 'hit';
      }
    } else if (matchedEvidence.length > 0) {
      observedStatus = 'hit';
    } else if (deadlinePassed) {
      observedStatus = 'missed';
    }

    return {
      ...condition,
      observedStatus,
      matchedEvidence,
    };
  });
}
