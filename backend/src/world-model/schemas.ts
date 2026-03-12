import { z } from 'zod';

import type { ResearchProfile } from '../retrieval/research-profile';
import type { WorldModelEntityKind, WorldModelEventKind } from '../store/types';

const ENTITY_KIND_VALUES = [
  'actor',
  'organization',
  'country',
  'asset',
  'route',
  'facility',
  'commodity',
  'policy',
  'other',
] as const satisfies ReadonlyArray<WorldModelEntityKind>;

const EVENT_KIND_VALUES = [
  'geopolitical',
  'contract',
  'policy',
  'market',
  'operational',
  'financial',
  'other',
] as const satisfies ReadonlyArray<WorldModelEventKind>;

const CHANNEL_VALUES = ['physical', 'contractual', 'financial', 'political', 'narrative', 'other'] as const;
const EPISTEMIC_STATUS_VALUES = ['extracted'] as const;

export type WorldModelCandidateChannel = (typeof CHANNEL_VALUES)[number];
export type WorldModelCandidateEpistemicStatus = (typeof EPISTEMIC_STATUS_VALUES)[number];

export const worldModelCandidateEntitySchema = z.object({
  key: z.string().min(1),
  kind: z.enum(ENTITY_KIND_VALUES),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  sourceUrls: z.array(z.string().min(1)).default([]),
  mentionCount: z.number().int().nonnegative(),
  epistemicStatus: z.enum(EPISTEMIC_STATUS_VALUES),
});

export const worldModelCandidateClaimSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  sourceUrls: z.array(z.string().min(1)).default([]),
  entityKeys: z.array(z.string().min(1)).default([]),
  eventKeys: z.array(z.string().min(1)).default([]),
  channel: z.enum(CHANNEL_VALUES),
  epistemicStatus: z.enum(EPISTEMIC_STATUS_VALUES),
});

export const worldModelCandidateEventSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(EVENT_KIND_VALUES),
  summary: z.string().min(1),
  occurredAt: z.string().min(1).nullable(),
  recordedAt: z.string().min(1).nullable(),
  sourceUrls: z.array(z.string().min(1)).default([]),
  entityKeys: z.array(z.string().min(1)).default([]),
  claimKeys: z.array(z.string().min(1)).default([]),
  channel: z.enum(CHANNEL_VALUES),
  epistemicStatus: z.enum(EPISTEMIC_STATUS_VALUES),
});

export const worldModelCandidateObservationSchema = z.object({
  key: z.string().min(1),
  metricKey: z.string().min(1),
  valueText: z.string().min(1),
  unit: z.string().min(1).nullable(),
  observedAt: z.string().min(1).nullable(),
  recordedAt: z.string().min(1).nullable(),
  sourceUrls: z.array(z.string().min(1)).default([]),
  entityKeys: z.array(z.string().min(1)).default([]),
  claimKeys: z.array(z.string().min(1)).default([]),
  channel: z.enum(CHANNEL_VALUES),
  epistemicStatus: z.enum(EPISTEMIC_STATUS_VALUES),
});

export const worldModelExtractionSchema = z.object({
  schemaVersion: z.literal('2026-03-10'),
  status: z.literal('candidate'),
  generatedAt: z.string().min(1),
  query: z.string().min(1),
  researchProfile: z.custom<ResearchProfile>(),
  entities: z.array(worldModelCandidateEntitySchema),
  events: z.array(worldModelCandidateEventSchema),
  observations: z.array(worldModelCandidateObservationSchema),
  claims: z.array(worldModelCandidateClaimSchema),
  stats: z.object({
    sourceCount: z.number().int().nonnegative(),
    entityCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    observationCount: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(),
  }),
});

export type WorldModelCandidateEntity = z.infer<typeof worldModelCandidateEntitySchema>;
export type WorldModelCandidateClaim = z.infer<typeof worldModelCandidateClaimSchema>;
export type WorldModelCandidateEvent = z.infer<typeof worldModelCandidateEventSchema>;
export type WorldModelCandidateObservation = z.infer<typeof worldModelCandidateObservationSchema>;
export type WorldModelExtraction = z.infer<typeof worldModelExtractionSchema>;
