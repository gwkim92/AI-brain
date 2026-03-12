import type { WorldModelExtraction } from './schemas';

export const WORLD_MODEL_STATE_KEYS = [
  'route_risk',
  'freight_pressure',
  'insurance_pressure',
  'contract_urgency',
  'inflation_passthrough_risk',
  'rate_repricing_pressure',
] as const;

export type WorldModelStateKey = (typeof WORLD_MODEL_STATE_KEYS)[number];
export type WorldModelStateDirection = 'up' | 'flat';

export type WorldModelStateVariable = {
  key: WorldModelStateKey;
  score: number;
  direction: WorldModelStateDirection;
  drivers: string[];
  evidenceClaimKeys: string[];
};

export type WorldModelStateModel = {
  generatedAt: string;
  variables: Record<WorldModelStateKey, WorldModelStateVariable>;
  dominantSignals: WorldModelStateKey[];
  notes: string[];
};

type MutableStateVariable = {
  score: number;
  drivers: Set<string>;
  evidenceClaimKeys: Set<string>;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function createMutableState(): Record<WorldModelStateKey, MutableStateVariable> {
  return {
    route_risk: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
    freight_pressure: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
    insurance_pressure: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
    contract_urgency: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
    inflation_passthrough_risk: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
    rate_repricing_pressure: { score: 0, drivers: new Set(), evidenceClaimKeys: new Set() },
  };
}

function addSignal(
  state: Record<WorldModelStateKey, MutableStateVariable>,
  key: WorldModelStateKey,
  weight: number,
  driver: string,
  claimKeys: string[] = []
) {
  state[key].score += weight;
  state[key].drivers.add(driver);
  for (const claimKey of claimKeys) {
    state[key].evidenceClaimKeys.add(claimKey);
  }
}

function signalTextMatches(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export function buildWorldModelState(input: { extraction: WorldModelExtraction }): WorldModelStateModel {
  const { extraction } = input;
  const state = createMutableState();

  for (const entity of extraction.entities) {
    if (entity.kind === 'route') {
      addSignal(state, 'route_risk', 0.18, `${entity.canonicalName} route exposure`);
      addSignal(state, 'freight_pressure', 0.08, `${entity.canonicalName} route dependency`);
    }
    if (entity.kind === 'commodity' && /(lng|oil|gas)/iu.test(entity.canonicalName)) {
      addSignal(state, 'contract_urgency', 0.08, `${entity.canonicalName} supply tightness`);
      addSignal(state, 'inflation_passthrough_risk', 0.05, `${entity.canonicalName} pass-through sensitivity`);
    }
    if (entity.kind === 'policy' && /(Federal Reserve|US Treasury|European Union)/iu.test(entity.canonicalName)) {
      addSignal(state, 'rate_repricing_pressure', 0.06, `${entity.canonicalName} policy sensitivity`);
    }
  }

  for (const event of extraction.events) {
    if (event.kind === 'geopolitical') {
      addSignal(state, 'route_risk', 0.32, 'geopolitical disruption', event.claimKeys);
      addSignal(state, 'insurance_pressure', 0.12, 'geopolitical insurance repricing', event.claimKeys);
      addSignal(state, 'contract_urgency', 0.1, 'buyers seek supply security', event.claimKeys);
    }
    if (event.kind === 'contract') {
      addSignal(state, 'contract_urgency', 0.28, 'contracting activity', event.claimKeys);
    }
    if (event.kind === 'policy') {
      addSignal(state, 'inflation_passthrough_risk', 0.08, 'policy spillover', event.claimKeys);
      addSignal(state, 'rate_repricing_pressure', 0.14, 'policy repricing signal', event.claimKeys);
    }
    if (event.kind === 'market') {
      addSignal(state, 'freight_pressure', 0.12, 'market volatility signal', event.claimKeys);
      addSignal(state, 'rate_repricing_pressure', 0.08, 'market repricing signal', event.claimKeys);
    }
    if (event.kind === 'operational') {
      addSignal(state, 'freight_pressure', 0.12, 'operational throughput risk', event.claimKeys);
      addSignal(state, 'contract_urgency', 0.08, 'operational bottleneck signal', event.claimKeys);
    }
  }

  for (const observation of extraction.observations) {
    if (observation.metricKey === 'shipping_rate') {
      addSignal(state, 'freight_pressure', 0.38, 'shipping-rate observation', observation.claimKeys);
      addSignal(state, 'route_risk', 0.08, 'route pricing response', observation.claimKeys);
    }
    if (observation.metricKey === 'insurance_cost') {
      addSignal(state, 'insurance_pressure', 0.42, 'insurance-cost observation', observation.claimKeys);
      addSignal(state, 'route_risk', 0.08, 'insurance repricing response', observation.claimKeys);
    }
    if (observation.metricKey === 'price_signal') {
      addSignal(state, 'inflation_passthrough_risk', 0.24, 'commodity price signal', observation.claimKeys);
    }
    if (observation.metricKey === 'rate_signal') {
      addSignal(state, 'rate_repricing_pressure', 0.34, 'rate/yield signal', observation.claimKeys);
    }
    if (observation.metricKey === 'capacity_signal') {
      addSignal(state, 'contract_urgency', 0.14, 'capacity or inventory signal', observation.claimKeys);
    }
  }

  for (const claim of extraction.claims) {
    const text = claim.text;
    if (signalTextMatches(text, /(hormuz|red sea|suez|항로|해협|홍해|호르무즈|수에즈)/iu)) {
      addSignal(state, 'route_risk', 0.14, 'route chokepoint mention', [claim.key]);
    }
    if (signalTextMatches(text, /(freight|shipping rate|shipment|cargo|운임|선적|해상운임)/iu)) {
      addSignal(state, 'freight_pressure', 0.16, 'freight signal mention', [claim.key]);
    }
    if (signalTextMatches(text, /(insurance|premium|보험료|보험)/iu)) {
      addSignal(state, 'insurance_pressure', 0.18, 'insurance signal mention', [claim.key]);
    }
    if (signalTextMatches(text, /(contract|agreement|deal|spa|장기계약|계약|합의)/iu)) {
      addSignal(state, 'contract_urgency', 0.18, 'contracting signal mention', [claim.key]);
    }
    if (signalTextMatches(text, /(inflation|cpi|pass-?through|인플레|물가|전가)/iu)) {
      addSignal(state, 'inflation_passthrough_risk', 0.18, 'inflation mention', [claim.key]);
    }
    if (signalTextMatches(text, /(rate|yield|treasury|fed|금리|수익률|국채|연준)/iu)) {
      addSignal(state, 'rate_repricing_pressure', 0.18, 'rate repricing mention', [claim.key]);
    }
  }

  state.freight_pressure.score += state.route_risk.score * 0.18;
  state.insurance_pressure.score += state.route_risk.score * 0.14;
  state.inflation_passthrough_risk.score += state.freight_pressure.score * 0.22 + state.insurance_pressure.score * 0.18;
  state.rate_repricing_pressure.score += state.inflation_passthrough_risk.score * 0.28;

  const variables = Object.fromEntries(
    WORLD_MODEL_STATE_KEYS.map((key) => {
      const score = clampScore(state[key].score);
      return [
        key,
        {
          key,
          score,
          direction: score >= 0.15 ? 'up' : 'flat',
          drivers: [...state[key].drivers].sort((left, right) => left.localeCompare(right)),
          evidenceClaimKeys: [...state[key].evidenceClaimKeys].sort((left, right) => left.localeCompare(right)),
        } satisfies WorldModelStateVariable,
      ];
    })
  ) as Record<WorldModelStateKey, WorldModelStateVariable>;

  const dominantSignals = [...WORLD_MODEL_STATE_KEYS]
    .filter((key) => variables[key].score >= 0.35)
    .sort((left, right) => variables[right].score - variables[left].score);

  const notes: string[] = [];
  if (variables.route_risk.score >= 0.5 && variables.freight_pressure.score >= 0.45) {
    notes.push('지정학 충격이 실제 물류 압력으로 전이되는 신호가 감지됐다.');
  }
  if (variables.contract_urgency.score >= 0.45) {
    notes.push('공급 불안이 계약 협상력 재편으로 이어질 가능성이 높다.');
  }
  if (variables.inflation_passthrough_risk.score >= 0.45 && variables.rate_repricing_pressure.score >= 0.4) {
    notes.push('실물 충격이 거시 변수 재평가로 이어질 수 있다.');
  }

  return {
    generatedAt: extraction.generatedAt,
    variables,
    dominantSignals,
    notes,
  };
}
