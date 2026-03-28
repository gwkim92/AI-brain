import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY,
  getWorldModelFixtureSet,
  listWorldModelFixtureSets,
  resolveWorldModelEvaluationFixtures,
} from '../fixtures';

describe('hyperagent world-model fixtures', () => {
  it('lists built-in fixture sets with metadata', () => {
    const fixtureSets = listWorldModelFixtureSets();

    expect(fixtureSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY,
          fixtureCount: 2,
        }),
      ])
    );
  });

  it('resolves built-in fixtures by default', () => {
    const resolved = resolveWorldModelEvaluationFixtures();
    const fixtureSet = getWorldModelFixtureSet();

    expect(resolved.fixtureSetKey).toBe(DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY);
    expect(resolved.fixtures).toHaveLength(fixtureSet.fixtures.length);
    expect(resolved.fixtures[0]?.fixtureId).toBe(fixtureSet.fixtures[0]?.fixtureId);
  });
});
