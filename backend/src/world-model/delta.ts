import type { DossierWorldModelBlock } from './dossier';

export type WorldModelDelta = {
  hasMeaningfulShift: boolean;
  reasons: string[];
  primaryHypothesisShift: number;
  counterHypothesisShift: number;
  invalidationHitCount: number;
  bottleneckShiftCount: number;
  topStateShift: { key: string; delta: number } | null;
};

function topHypothesisConfidence(block: DossierWorldModelBlock | null, stance: 'primary' | 'counter'): number {
  if (!block) return 0;
  return block.hypotheses
    .filter((hypothesis) => hypothesis.stance === stance)
    .sort((left, right) => right.confidence - left.confidence)[0]?.confidence ?? 0;
}

function invalidationHitCount(block: DossierWorldModelBlock | null): number {
  if (!block) return 0;
  return block.invalidation_conditions.filter((condition) => condition.observed_status === 'hit').length;
}

function bottleneckKeys(block: DossierWorldModelBlock | null): string[] {
  return block?.bottlenecks.map((entry) => entry.key) ?? [];
}

export function buildWorldModelDelta(input: {
  previous: DossierWorldModelBlock | null;
  current: DossierWorldModelBlock;
}): WorldModelDelta {
  const previousVariables = input.previous?.state_snapshot.variables ?? {};
  let topStateShift: { key: string; delta: number } | null = null;

  for (const [key, value] of Object.entries(input.current.state_snapshot.variables)) {
    const previousScore = previousVariables[key]?.score ?? 0;
    const delta = Number((value.score - previousScore).toFixed(3));
    if (!topStateShift || Math.abs(delta) > Math.abs(topStateShift.delta)) {
      topStateShift = { key, delta };
    }
  }

  const primaryHypothesisShift = Number(
    (topHypothesisConfidence(input.current, 'primary') - topHypothesisConfidence(input.previous, 'primary')).toFixed(3)
  );
  const counterHypothesisShift = Number(
    (topHypothesisConfidence(input.current, 'counter') - topHypothesisConfidence(input.previous, 'counter')).toFixed(3)
  );
  const invalidationShift = Math.max(0, invalidationHitCount(input.current) - invalidationHitCount(input.previous));
  const previousBottlenecks = new Set(bottleneckKeys(input.previous));
  const bottleneckShiftCount = bottleneckKeys(input.current).filter((key) => !previousBottlenecks.has(key)).length;

  const reasons: string[] = [];
  if (topStateShift && Math.abs(topStateShift.delta) >= 0.18) reasons.push('state_acceleration');
  if (Math.abs(primaryHypothesisShift) >= 0.15) reasons.push('primary_hypothesis_shift');
  if (Math.abs(counterHypothesisShift) >= 0.15) reasons.push('counter_hypothesis_shift');
  if (invalidationShift > 0) reasons.push('invalidation_hit');
  if (bottleneckShiftCount > 0) reasons.push('bottleneck_shift');

  return {
    hasMeaningfulShift: reasons.length > 0,
    reasons,
    primaryHypothesisShift,
    counterHypothesisShift,
    invalidationHitCount: invalidationShift,
    bottleneckShiftCount,
    topStateShift,
  };
}
