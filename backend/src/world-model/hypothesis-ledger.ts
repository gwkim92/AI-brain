import type { WorldModelHypothesisEvidenceRelation, WorldModelHypothesisStance, WorldModelHypothesisStatus } from '../store/types';

import { buildPendingInvalidationCondition, evaluateInvalidationConditions, type WorldModelInvalidationConditionDraft } from './invalidation';
import type { WorldModelExtraction } from './schemas';
import type { WorldModelStateKey, WorldModelStateModel } from './state-model';

export type WorldModelHypothesisEvidenceDraft = {
  claimText: string;
  relation: WorldModelHypothesisEvidenceRelation;
  sourceUrls: string[];
  weight: number;
};

export type WorldModelHypothesisDraft = {
  thesis: string;
  stance: WorldModelHypothesisStance;
  confidence: number;
  status: WorldModelHypothesisStatus;
  summary: string;
  watchStateKeys: WorldModelStateKey[];
  evidence: WorldModelHypothesisEvidenceDraft[];
  invalidationConditions: WorldModelInvalidationConditionDraft[];
};

function clampConfidence(value: number): number {
  return Math.max(0.05, Math.min(0.95, Number(value.toFixed(3))));
}

function summarizeState(state: WorldModelStateModel, keys: WorldModelStateKey[]): string {
  return keys.map((key) => `${key}=${state.variables[key].score.toFixed(2)}`).join(', ');
}

function pickEvidence(input: {
  extraction: WorldModelExtraction;
  maxItems?: number;
  relation?: WorldModelHypothesisEvidenceRelation;
  predicate: (claim: WorldModelExtraction['claims'][number]) => boolean;
}): WorldModelHypothesisEvidenceDraft[] {
  const maxItems = input.maxItems ?? 3;
  const relation = input.relation ?? 'supports';
  return input.extraction.claims
    .filter(input.predicate)
    .slice(0, maxItems)
    .map((claim, index) => ({
      claimText: claim.text,
      relation,
      sourceUrls: [...claim.sourceUrls],
      weight: Number((0.85 - index * 0.15).toFixed(2)),
    }));
}

function deriveStatus(confidence: number, invalidations: WorldModelInvalidationConditionDraft[]): WorldModelHypothesisStatus {
  const highHits = invalidations.filter((condition) => condition.observedStatus === 'hit' && condition.severity === 'high').length;
  const anyHit = invalidations.some((condition) => condition.observedStatus === 'hit');
  if (highHits >= 2 || (highHits >= 1 && confidence < 0.4)) return 'invalidated';
  if (anyHit || confidence < 0.38) return 'weakened';
  return 'active';
}

function buildPrimaryHypotheses(input: {
  extraction: WorldModelExtraction;
  state: WorldModelStateModel;
  now?: string;
}): WorldModelHypothesisDraft[] {
  const hypotheses: WorldModelHypothesisDraft[] = [];
  const logisticsScore = Math.max(
    input.state.variables.route_risk.score,
    input.state.variables.freight_pressure.score,
    input.state.variables.insurance_pressure.score
  );
  if (logisticsScore >= 0.4) {
    const invalidationConditions = evaluateInvalidationConditions({
      extraction: input.extraction,
      now: input.now,
      conditions: [
        buildPendingInvalidationCondition(input.extraction, {
          description: '72시간 안에 운임 또는 보험 비용 후속 신호가 이어지지 않으면 물류 압력 가설을 약화한다.',
          daysUntilCheck: 3,
          severity: 'high',
          mode: 'requires_evidence',
          watchMetricKeys: ['shipping_rate', 'insurance_cost'],
          watchKeywords: ['freight', 'shipping rate', 'insurance', '운임', '보험'],
        }),
        buildPendingInvalidationCondition(input.extraction, {
          description: '14일 안에 계약 또는 운영 차질 신호가 연결되지 않으면 구조 재편 해석을 약화한다.',
          daysUntilCheck: 14,
          severity: 'medium',
          mode: 'requires_evidence',
          watchEventKinds: ['contract', 'operational'],
        }),
      ],
    });
    const confidence = clampConfidence(logisticsScore * 0.78 + input.state.variables.contract_urgency.score * 0.12);
    hypotheses.push({
      thesis: '지정학 충격이 항로·보험 병목을 키우며 실제 물류 비용 압력으로 전이되고 있다.',
      stance: 'primary',
      confidence,
      status: deriveStatus(confidence, invalidationConditions),
      summary: `핵심 상태: ${summarizeState(input.state, ['route_risk', 'freight_pressure', 'insurance_pressure'])}`,
      watchStateKeys: ['route_risk', 'freight_pressure', 'insurance_pressure'],
      evidence: pickEvidence({
        extraction: input.extraction,
        predicate: (claim) =>
          /(hormuz|red sea|suez|freight|shipping|insurance|운임|보험|홍해|호르무즈|수에즈)/iu.test(claim.text),
      }),
      invalidationConditions,
    });
  }

  const contractScore = input.state.variables.contract_urgency.score;
  if (contractScore >= 0.4) {
    const invalidationConditions = evaluateInvalidationConditions({
      extraction: input.extraction,
      now: input.now,
      conditions: [
        buildPendingInvalidationCondition(input.extraction, {
          description: '2주 안에 장기계약 또는 공급 확보 신호가 안 나오면 계약 긴급성 가설을 약화한다.',
          daysUntilCheck: 14,
          severity: 'high',
          mode: 'requires_evidence',
          watchEventKinds: ['contract'],
        }),
        buildPendingInvalidationCondition(input.extraction, {
          description: '가격·운임 압력이 빠르게 진정되면 계약 전환 압력 해석을 약화한다.',
          daysUntilCheck: 7,
          severity: 'medium',
          mode: 'forbids_evidence',
          watchKeywords: ['ceasefire', 'normalization', 'supply recovered', '휴전', '정상화'],
        }),
      ],
    });
    const confidence = clampConfidence(contractScore * 0.74 + input.state.variables.route_risk.score * 0.14);
    hypotheses.push({
      thesis: '공급 불안이 장기계약 수용성과 공급자 협상력을 높일 가능성이 크다.',
      stance: 'primary',
      confidence,
      status: deriveStatus(confidence, invalidationConditions),
      summary: `핵심 상태: ${summarizeState(input.state, ['contract_urgency', 'route_risk', 'freight_pressure'])}`,
      watchStateKeys: ['contract_urgency', 'route_risk', 'freight_pressure'],
      evidence: pickEvidence({
        extraction: input.extraction,
        predicate: (claim) => /(contract|agreement|deal|spa|lng|장기계약|계약|가스)/iu.test(claim.text),
      }),
      invalidationConditions,
    });
  }

  const macroScore = Math.max(
    input.state.variables.inflation_passthrough_risk.score,
    input.state.variables.rate_repricing_pressure.score
  );
  if (macroScore >= 0.42) {
    const invalidationConditions = evaluateInvalidationConditions({
      extraction: input.extraction,
      now: input.now,
      conditions: [
        buildPendingInvalidationCondition(input.extraction, {
          description: '7일 안에 가격·금리 후속 반응이 이어지지 않으면 거시 전이 가설을 약화한다.',
          daysUntilCheck: 7,
          severity: 'medium',
          mode: 'requires_evidence',
          watchMetricKeys: ['price_signal', 'rate_signal'],
          watchKeywords: ['inflation', 'rate', 'yield', 'price', '물가', '금리', '수익률'],
        }),
      ],
    });
    const confidence = clampConfidence(macroScore * 0.8);
    hypotheses.push({
      thesis: '물류·에너지 압력이 인플레 경로와 금리 재평가 압력을 키우고 있다.',
      stance: 'primary',
      confidence,
      status: deriveStatus(confidence, invalidationConditions),
      summary: `핵심 상태: ${summarizeState(input.state, ['inflation_passthrough_risk', 'rate_repricing_pressure'])}`,
      watchStateKeys: ['inflation_passthrough_risk', 'rate_repricing_pressure'],
      evidence: pickEvidence({
        extraction: input.extraction,
        predicate: (claim) => /(inflation|rate|yield|treasury|fed|price|물가|금리|수익률|국채|연준)/iu.test(claim.text),
      }),
      invalidationConditions,
    });
  }

  if (hypotheses.length === 0) {
    const fallbackInvalidations = evaluateInvalidationConditions({
      extraction: input.extraction,
      now: input.now,
      conditions: [
        buildPendingInvalidationCondition(input.extraction, {
          description: '1주 안에 운임·계약·가격 신호가 전혀 없으면 구조 전이 가설을 약화한다.',
          daysUntilCheck: 7,
          severity: 'medium',
          mode: 'requires_evidence',
          watchMetricKeys: ['shipping_rate', 'price_signal'],
          watchEventKinds: ['contract', 'operational'],
          watchKeywords: ['freight', 'contract', 'price', '운임', '계약', '가격'],
        }),
      ],
    });
    const confidence = clampConfidence(0.36 + input.state.dominantSignals.length * 0.04);
    hypotheses.push({
      thesis: '현재 충격이 구조적 재편으로 전이될 가능성이 있으나 확인 신호는 아직 제한적이다.',
      stance: 'primary',
      confidence,
      status: deriveStatus(confidence, fallbackInvalidations),
      summary: `핵심 상태: ${summarizeState(input.state, ['route_risk', 'contract_urgency'])}`,
      watchStateKeys: ['route_risk', 'contract_urgency'],
      evidence: pickEvidence({
        extraction: input.extraction,
        relation: 'context',
        predicate: () => true,
        maxItems: 2,
      }),
      invalidationConditions: fallbackInvalidations,
    });
  }

  return hypotheses;
}

function buildCounterHypothesis(input: {
  extraction: WorldModelExtraction;
  state: WorldModelStateModel;
  now?: string;
}): WorldModelHypothesisDraft {
  const directSignalStrength = Math.max(
    input.state.variables.freight_pressure.score,
    input.state.variables.contract_urgency.score,
    input.state.variables.rate_repricing_pressure.score
  );
  const sparseObservationBoost = input.extraction.observations.length === 0 ? 0.14 : 0;
  const confidence = clampConfidence(0.58 - directSignalStrength * 0.34 + sparseObservationBoost);
  const invalidationConditions = evaluateInvalidationConditions({
    extraction: input.extraction,
    now: input.now,
    conditions: [
      buildPendingInvalidationCondition(input.extraction, {
        description: '72시간 안에 운임·보험 관측치가 붙으면 헤드라인 노이즈 가설을 약화한다.',
        daysUntilCheck: 3,
        severity: 'high',
        mode: 'forbids_evidence',
        watchMetricKeys: ['shipping_rate', 'insurance_cost'],
        watchKeywords: ['freight', 'shipping rate', 'insurance', '운임', '보험'],
      }),
        buildPendingInvalidationCondition(input.extraction, {
          description: '2주 안에 계약 체결 또는 운영 차질이 확인되면 구조 재편 부정 가설을 약화한다.',
          daysUntilCheck: 14,
          severity: 'high',
          mode: 'forbids_evidence',
          watchEventKinds: ['contract', 'operational'],
        }),
    ],
  });

  const evidence =
    pickEvidence({
      extraction: input.extraction,
      relation: 'context',
      predicate: (claim) => claim.channel === 'political' || claim.channel === 'narrative',
      maxItems: 2,
    }).length > 0
      ? pickEvidence({
          extraction: input.extraction,
          relation: 'context',
          predicate: (claim) => claim.channel === 'political' || claim.channel === 'narrative',
          maxItems: 2,
        })
      : pickEvidence({
          extraction: input.extraction,
          relation: 'context',
          predicate: () => true,
          maxItems: 1,
        });

  return {
    thesis: '현재 충격은 헤드라인 노이즈일 수 있으며 아직 구조적 계약·물류 재편의 확인 신호는 제한적이다.',
    stance: 'counter',
    confidence,
    status: deriveStatus(confidence, invalidationConditions),
    summary: `핵심 상태: ${summarizeState(input.state, ['route_risk', 'freight_pressure', 'contract_urgency'])}`,
    watchStateKeys: ['route_risk', 'freight_pressure', 'contract_urgency'],
    evidence,
    invalidationConditions,
  };
}

export function buildHypothesisLedger(input: {
  extraction: WorldModelExtraction;
  state: WorldModelStateModel;
  now?: string;
}): WorldModelHypothesisDraft[] {
  const primary = buildPrimaryHypotheses(input);
  const counter = buildCounterHypothesis(input);
  return [...primary, counter];
}
