import { getAppliedHyperAgentArtifactOverride, resolveAppliedArtifactOverride } from '../hyperagent/runtime';
import type { RadarDomainId, RadarDomainPackDefinition } from '../store/types';

export const RADAR_DOMAIN_PACKS: RadarDomainPackDefinition[] = [
  {
    id: 'geopolitics_energy_lng',
    displayName: 'Geopolitics / Energy / LNG',
    ontology: ['country', 'shipping_route', 'lng_terminal', 'commodity', 'insurer'],
    mechanismTemplates: [
      'route_risk -> insurance_pressure',
      'insurance_pressure -> freight_pressure',
      'freight_pressure -> contract_urgency',
      'contract_urgency -> lng_contract_probability',
      'lng_contract_probability -> inflation_passthrough_risk',
    ],
    stateVariables: [
      'route_risk',
      'insurance_pressure',
      'freight_pressure',
      'contract_urgency',
      'inflation_passthrough_risk',
      'rate_repricing_pressure',
    ],
    invalidationTemplates: [
      'insurance/freight proxies fail to react',
      'long-term contract announcements do not appear',
      'alternate supply opens quickly',
    ],
    watchMetrics: ['lng_freight', 'insurance_spread', 'lng_contracts', 'ttf', 'jkm', 'us10y'],
    keywordLexicon: [
      'lng',
      'hormuz',
      'strait',
      'terminal',
      'pipeline',
      'cargo',
      'insurance',
      'freight',
      'regasification',
      'sanction',
    ],
    actionMapping: {
      watcherKind: 'war_region',
      sessionIntent: 'news',
      defaultActionKind: 'notify',
      executionMode: 'execute_auto',
    },
  },
  {
    id: 'macro_rates_inflation_fx',
    displayName: 'Macro / Rates / Inflation / FX',
    ontology: ['central_bank', 'currency', 'bond', 'inflation_metric'],
    mechanismTemplates: [
      'inflation_shock -> rate_repricing',
      'rate_repricing -> fx_shift',
      'fx_shift -> imported_inflation',
    ],
    stateVariables: ['inflation_passthrough_risk', 'rate_repricing_pressure'],
    invalidationTemplates: [
      'yields do not move',
      'fx reaction fades quickly',
      'inflation expectations remain anchored',
    ],
    watchMetrics: ['us2y', 'us10y', 'dxy', 'cpi_swap', 'breakeven'],
    keywordLexicon: ['inflation', 'cpi', 'yield', 'treasury', 'rate cut', 'fx', 'dollar', 'fed', 'ecb'],
    actionMapping: {
      watcherKind: 'market',
      sessionIntent: 'finance',
      defaultActionKind: 'notify',
      executionMode: 'proposal_auto',
    },
  },
  {
    id: 'shipping_supply_chain',
    displayName: 'Shipping / Supply Chain',
    ontology: ['route', 'port', 'carrier', 'insurer', 'manufacturer'],
    mechanismTemplates: [
      'route_disruption -> freight_pressure',
      'freight_pressure -> margin_pressure',
      'inventory_mismatch -> rerouting',
    ],
    stateVariables: ['freight_pressure', 'route_risk', 'contract_urgency'],
    invalidationTemplates: [
      'freight indexes remain flat',
      'port throughput normalizes quickly',
      'rerouting capacity absorbs shock',
    ],
    watchMetrics: ['freight_index', 'port_throughput', 'container_rate', 'inventory_days'],
    keywordLexicon: ['shipping', 'vessel', 'port', 'container', 'reroute', 'throughput', 'inventory', 'carrier'],
    actionMapping: {
      watcherKind: 'market',
      sessionIntent: 'news',
      defaultActionKind: 'notify',
      executionMode: 'proposal_auto',
    },
  },
  {
    id: 'policy_regulation_platform_ai',
    displayName: 'Policy / Regulation / Platform AI',
    ontology: ['regulator', 'platform', 'ai_vendor', 'policy_body'],
    mechanismTemplates: [
      'policy_change -> compliance_cost',
      'compliance_cost -> platform_repricing',
      'regulation_signal -> vendor_rotation',
    ],
    stateVariables: ['contract_urgency', 'rate_repricing_pressure'],
    invalidationTemplates: [
      'formal rule text does not materialize',
      'platform guidance unchanged',
      'enforcement lags',
    ],
    watchMetrics: ['policy_calendar', 'platform_guidance', 'cloud_pricing'],
    keywordLexicon: ['regulation', 'policy', 'ai act', 'antitrust', 'privacy', 'platform', 'compliance', 'openai'],
    actionMapping: {
      watcherKind: 'external_topic',
      sessionIntent: 'research',
      defaultActionKind: 'notify',
      executionMode: 'proposal_auto',
    },
  },
  {
    id: 'company_earnings_guidance',
    displayName: 'Company / Earnings / Guidance',
    ontology: ['company', 'sector', 'guidance', 'capex'],
    mechanismTemplates: [
      'guidance_change -> sector_rerating',
      'capex_signal -> supplier_benefit',
      'margin_warning -> estimate_revision',
    ],
    stateVariables: ['contract_urgency', 'rate_repricing_pressure'],
    invalidationTemplates: [
      'follow-on guidance absent',
      'peer reaction does not confirm',
      'estimate revisions do not follow',
    ],
    watchMetrics: ['guidance_delta', 'estimate_revision', 'relative_strength'],
    keywordLexicon: ['earnings', 'guidance', 'capex', 'margin', 'beat', 'miss', 'backlog', 'outlook'],
    actionMapping: {
      watcherKind: 'company',
      sessionIntent: 'finance',
      defaultActionKind: 'notify',
      executionMode: 'proposal_auto',
    },
  },
  {
    id: 'commodities_raw_materials',
    displayName: 'Commodities / Raw Materials',
    ontology: ['commodity', 'producer', 'buyer', 'inventory'],
    mechanismTemplates: [
      'supply_shock -> spot_price',
      'inventory_draw -> contract_urgency',
      'commodity_move -> downstream_margin',
    ],
    stateVariables: ['contract_urgency', 'inflation_passthrough_risk'],
    invalidationTemplates: [
      'spot move reverses immediately',
      'inventory data does not confirm',
      'downstream prices fail to react',
    ],
    watchMetrics: ['spot_price', 'inventory', 'term_structure'],
    keywordLexicon: ['commodity', 'copper', 'oil', 'brent', 'inventory', 'mine', 'smelter', 'supply cut'],
    actionMapping: {
      watcherKind: 'market',
      sessionIntent: 'finance',
      defaultActionKind: 'notify',
      executionMode: 'proposal_auto',
    },
  },
];

function clonePack(pack: RadarDomainPackDefinition): RadarDomainPackDefinition {
  return {
    ...pack,
    ontology: [...pack.ontology],
    mechanismTemplates: [...pack.mechanismTemplates],
    stateVariables: [...pack.stateVariables],
    invalidationTemplates: [...pack.invalidationTemplates],
    watchMetrics: [...pack.watchMetrics],
    keywordLexicon: [...pack.keywordLexicon],
    actionMapping: { ...pack.actionMapping },
  };
}

function resolveRuntimeRadarDomainPacks(): RadarDomainPackDefinition[] {
  const applied = getAppliedHyperAgentArtifactOverride('radar_domain_pack');
  const resolved = resolveAppliedArtifactOverride({
    artifactKey: 'radar_domain_pack',
    applied,
    fallback: {
      domainPacks: RADAR_DOMAIN_PACKS.map((pack) => clonePack(pack)),
    },
  });
  const domainPacks = resolved.domainPacks;
  if (!Array.isArray(domainPacks)) {
    return RADAR_DOMAIN_PACKS.map((pack) => clonePack(pack));
  }

  return domainPacks
    .filter((pack): pack is RadarDomainPackDefinition => {
      return (
        typeof pack === 'object' &&
        pack !== null &&
        typeof (pack as RadarDomainPackDefinition).id === 'string' &&
        Array.isArray((pack as RadarDomainPackDefinition).ontology) &&
        Array.isArray((pack as RadarDomainPackDefinition).mechanismTemplates) &&
        Array.isArray((pack as RadarDomainPackDefinition).stateVariables) &&
        Array.isArray((pack as RadarDomainPackDefinition).invalidationTemplates) &&
        Array.isArray((pack as RadarDomainPackDefinition).watchMetrics) &&
        Array.isArray((pack as RadarDomainPackDefinition).keywordLexicon) &&
        typeof (pack as RadarDomainPackDefinition).actionMapping === 'object'
      );
    })
    .map((pack) => clonePack(pack));
}

export function listRadarDomainPacks(): RadarDomainPackDefinition[] {
  return resolveRuntimeRadarDomainPacks();
}

export function getRadarDomainPack(domainId: RadarDomainId): RadarDomainPackDefinition | null {
  const match = resolveRuntimeRadarDomainPacks().find((pack) => pack.id === domainId);
  return match ? clonePack(match) : null;
}
