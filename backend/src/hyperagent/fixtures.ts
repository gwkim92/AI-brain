import type { WorldModelEvaluationFixture } from './world-model-evaluator';

export const WORLD_MODEL_FIXTURE_SET_KEYS = ['world_model_smoke_v1'] as const;

export type WorldModelFixtureSetKey = (typeof WORLD_MODEL_FIXTURE_SET_KEYS)[number];

export type WorldModelFixtureSet = {
  key: WorldModelFixtureSetKey;
  title: string;
  description: string;
  fixtures: WorldModelEvaluationFixture[];
};

export const DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY: WorldModelFixtureSetKey = 'world_model_smoke_v1';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const WORLD_MODEL_FIXTURE_SETS: Record<WorldModelFixtureSetKey, WorldModelFixtureSet> = {
  world_model_smoke_v1: {
    key: 'world_model_smoke_v1',
    title: 'World-Model Smoke V1',
    description: 'Deterministic smoke fixtures for dossier config promotion checks across market and policy narratives.',
    fixtures: [
      {
        fixtureId: 'lng-shipping-pressure',
        extractionInput: {
          query: '중동 충돌이 LNG 계약과 운임에 미치는 영향',
          researchProfile: 'market_research',
          generatedAt: '2026-03-10T00:00:00Z',
          sources: [
            {
              url: 'https://www.reuters.com/world/middle-east/lng-shipping',
              title: 'Qatar signs LNG deal as freight rates jump',
              domain: 'www.reuters.com',
              publishedAt: '2026-03-10T00:00:00Z',
              snippet: 'Shipping rates rose 12% and insurers raised premiums after conflict fears.',
            },
          ],
          claims: [
            {
              claimText:
                'Qatar signed an LNG contract after the Iran-Israel conflict pushed shipping rates up 12% and lifted insurance costs.',
              sourceUrls: ['https://www.reuters.com/world/middle-east/lng-shipping'],
            },
          ],
        },
        expectedPrimaryThesisPresent: true,
        expectedCounterHypothesisPresent: true,
        minInvalidationConditions: 1,
        minBottlenecks: 1,
        maxNextWatchSignals: 4,
      },
      {
        fixtureId: 'policy-platform-ai',
        extractionInput: {
          query: 'EU AI Act enforcement가 클라우드와 플랫폼 가격 정책에 미치는 영향',
          researchProfile: 'policy_regulation',
          generatedAt: '2026-03-12T00:00:00Z',
          sources: [
            {
              url: 'https://www.ft.com/content/eu-ai-act-cloud-pricing',
              title: 'EU AI Act compliance pushes cloud vendors toward new pricing tiers',
              domain: 'www.ft.com',
              publishedAt: '2026-03-12T00:00:00Z',
              snippet: 'Cloud vendors warned that compliance staffing and audit requirements may raise enterprise AI pricing.',
            },
          ],
          claims: [
            {
              claimText:
                'EU AI Act enforcement pressure may raise enterprise AI compliance costs and trigger cloud vendor repricing, though delayed enforcement could mute the impact.',
              sourceUrls: ['https://www.ft.com/content/eu-ai-act-cloud-pricing'],
            },
          ],
        },
        expectedPrimaryThesisPresent: true,
        expectedCounterHypothesisPresent: true,
        minInvalidationConditions: 1,
        minBottlenecks: 1,
        maxNextWatchSignals: 4,
      },
    ],
  },
};

export function listWorldModelFixtureSets(): Array<{
  key: WorldModelFixtureSetKey;
  title: string;
  description: string;
  fixtureCount: number;
}> {
  return WORLD_MODEL_FIXTURE_SET_KEYS.map((key) => ({
    key,
    title: WORLD_MODEL_FIXTURE_SETS[key].title,
    description: WORLD_MODEL_FIXTURE_SETS[key].description,
    fixtureCount: WORLD_MODEL_FIXTURE_SETS[key].fixtures.length,
  }));
}

export function getWorldModelFixtureSet(
  key: WorldModelFixtureSetKey = DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY
): WorldModelFixtureSet {
  return cloneJson(WORLD_MODEL_FIXTURE_SETS[key]);
}

export function resolveWorldModelEvaluationFixtures(input?: {
  fixtureSetKey?: WorldModelFixtureSetKey;
  fixtures?: WorldModelEvaluationFixture[];
}): {
  fixtureSetKey: WorldModelFixtureSetKey | 'custom';
  fixtures: WorldModelEvaluationFixture[];
} {
  if (input?.fixtures && input.fixtures.length > 0) {
    return {
      fixtureSetKey: 'custom',
      fixtures: cloneJson(input.fixtures),
    };
  }

  const fixtureSet = getWorldModelFixtureSet(input?.fixtureSetKey ?? DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY);
  return {
    fixtureSetKey: fixtureSet.key,
    fixtures: fixtureSet.fixtures,
  };
}
