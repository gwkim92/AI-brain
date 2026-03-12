import { normalizeGroundingUrl, type GroundingSource } from '../retrieval/grounding';
import type { WorldModelEntityKind, WorldModelEventKind } from '../store/types';

import type { WorldModelCandidateChannel } from './schemas';

type LexiconEntity = {
  canonicalName: string;
  kind: WorldModelEntityKind;
  aliases: string[];
};

const WORLD_MODEL_ENTITY_LEXICON: LexiconEntity[] = [
  { canonicalName: 'Iran', kind: 'country', aliases: ['iran', '이란'] },
  { canonicalName: 'Israel', kind: 'country', aliases: ['israel', '이스라엘'] },
  { canonicalName: 'Qatar', kind: 'country', aliases: ['qatar', '카타르'] },
  { canonicalName: 'Saudi Arabia', kind: 'country', aliases: ['saudi arabia', 'saudi', '사우디아라비아', '사우디'] },
  { canonicalName: 'United Arab Emirates', kind: 'country', aliases: ['united arab emirates', 'uae', '아랍에미리트', 'uae'] },
  { canonicalName: 'United States', kind: 'country', aliases: ['united states', 'u.s.', 'u.s', 'usa', 'us', '미국'] },
  { canonicalName: 'China', kind: 'country', aliases: ['china', '중국'] },
  { canonicalName: 'Russia', kind: 'country', aliases: ['russia', '러시아'] },
  { canonicalName: 'Ukraine', kind: 'country', aliases: ['ukraine', '우크라이나'] },
  { canonicalName: 'European Union', kind: 'policy', aliases: ['european union', 'eu', '유럽연합', 'eu'] },
  { canonicalName: 'Hormuz Strait', kind: 'route', aliases: ['strait of hormuz', 'hormuz', '호르무즈', '호르무즈 해협'] },
  { canonicalName: 'Red Sea', kind: 'route', aliases: ['red sea', '홍해'] },
  { canonicalName: 'Suez Canal', kind: 'route', aliases: ['suez canal', 'suez', '수에즈 운하', '수에즈'] },
  { canonicalName: 'LNG', kind: 'commodity', aliases: ['lng', 'liquefied natural gas', '액화천연가스'] },
  { canonicalName: 'Natural Gas', kind: 'commodity', aliases: ['natural gas', 'gas', '천연가스', '가스'] },
  { canonicalName: 'Oil', kind: 'commodity', aliases: ['oil', 'crude', '원유', '석유'] },
  { canonicalName: 'US Treasury', kind: 'asset', aliases: ['us treasury', 'treasury', '미국 국채', '국채'] },
  { canonicalName: 'Federal Reserve', kind: 'policy', aliases: ['federal reserve', 'fed', '연준'] },
];

const PROPER_NOUN_STOPWORDS = new Set([
  'The',
  'A',
  'An',
  'Latest',
  'Breaking',
  'World',
  'News',
  'Update',
  'Market',
  'Policy',
  'Brief',
  'Today',
]);

const PROPER_NOUN_PATTERN = /\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})){0,2}\b/gu;
const ISO_DATE_PATTERN = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/u;
const NUMBER_WITH_UNIT_PATTERN =
  /(-?\d+(?:\.\d+)?)\s*(%|percent|bp|bps|basis points|달러|usd|억 달러|billion|million|mtpa|bcm|mmbtu|mb\/d|bpd|배럴|척|ships?|vessels?)/iu;

function normalizeAsciiToken(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

export function normalizeWorldModelText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function slugifyWorldModelKey(value: string): string {
  const normalized = normalizeWorldModelText(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'unknown';
}

export function canonicalizeWorldModelName(value: string): string {
  return normalizeWorldModelText(value)
    .replace(/\b(inc|corp|corporation|company|co|ltd|limited|plc)\.?\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function worldModelTokenMatchesText(alias: string, text: string): boolean {
  const normalizedAlias = normalizeAsciiToken(alias);
  const normalizedText = normalizeAsciiToken(text);
  if (!normalizedAlias || !normalizedText) return false;
  if (/^[a-z0-9.\- ]+$/iu.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'iu').test(normalizedText);
  }
  return normalizedText.includes(normalizedAlias);
}

export function scanLexiconEntities(texts: string[]): Array<{
  canonicalName: string;
  kind: WorldModelEntityKind;
  aliases: string[];
}> {
  const matches = new Map<string, { canonicalName: string; kind: WorldModelEntityKind; aliases: Set<string> }>();
  for (const entry of WORLD_MODEL_ENTITY_LEXICON) {
    const hitAliases = entry.aliases.filter((alias) => texts.some((text) => worldModelTokenMatchesText(alias, text)));
    if (hitAliases.length === 0) continue;
    matches.set(entry.canonicalName, {
      canonicalName: entry.canonicalName,
      kind: entry.kind,
      aliases: new Set(hitAliases),
    });
  }
  return [...matches.values()].map((entry) => ({
    canonicalName: entry.canonicalName,
    kind: entry.kind,
    aliases: [...entry.aliases].sort((left, right) => left.localeCompare(right)),
  }));
}

export function extractProperNounCandidates(texts: string[]): string[] {
  const values = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(PROPER_NOUN_PATTERN)) {
      const candidate = normalizeWorldModelText(match[0] ?? '');
      if (!candidate || PROPER_NOUN_STOPWORDS.has(candidate)) continue;
      if (candidate.length < 3) continue;
      values.add(candidate);
    }
  }
  return [...values];
}

export function inferWorldModelEntityKind(value: string): WorldModelEntityKind {
  const normalized = normalizeAsciiToken(value);
  if (!normalized) return 'other';
  if (
    WORLD_MODEL_ENTITY_LEXICON.some(
      (entry) => entry.kind === 'country' && entry.aliases.some((alias) => worldModelTokenMatchesText(alias, normalized))
    )
  ) {
    return 'country';
  }
  if (/(strait|canal|sea|해협|운하|항로)/iu.test(normalized)) return 'route';
  if (/(terminal|plant|facility|fab|refinery|터미널|플랜트|정유)/iu.test(normalized)) return 'facility';
  if (/(lng|gas|oil|crude|copper|uranium|bitcoin|ether|treasury|국채|원유|가스|천연가스)/iu.test(normalized)) return /(treasury|bitcoin|ether|국채)/iu.test(normalized)
    ? 'asset'
    : 'commodity';
  if (/(fed|ecb|ministry|commission|department|연준|위원회|정부|부)/iu.test(normalized)) return 'policy';
  if (/(holdings|group|corp|inc|ltd|llc|plc|bank|capital|openai|google|microsoft|nvidia|tsmc|삼성|현대|한화)/iu.test(normalized)) {
    return 'organization';
  }
  return /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}$/u.test(value) ? 'organization' : 'other';
}

export function inferWorldModelEventKind(value: string): WorldModelEventKind {
  const normalized = normalizeAsciiToken(value);
  if (/(war|conflict|strike|attack|missile|troops|sanction|ceasefire|전쟁|충돌|공습|공격|제재|휴전)/iu.test(normalized)) {
    return 'geopolitical';
  }
  if (/(contract|agreement|deal|spa|purchase agreement|장기계약|계약|딜)/iu.test(normalized)) {
    return 'contract';
  }
  if (/(policy|rule|regulation|tariff|ban|guidance|law|금리|정책|규제|관세|법안)/iu.test(normalized)) {
    return 'policy';
  }
  if (/(price|yield|spread|rally|selloff|surge|drop|운임|가격|수익률|스프레드|급등|급락)/iu.test(normalized)) {
    return 'market';
  }
  if (/(outage|maintenance|startup|shutdown|terminal|shipment|output|cargo|가동|정비|중단|증설|출하|선적)/iu.test(normalized)) {
    return 'operational';
  }
  if (/(financing|funding|loan|bond|issuance|capital|자금조달|대출|채권)/iu.test(normalized)) {
    return 'financial';
  }
  return 'other';
}

export function inferWorldModelChannel(value: string): WorldModelCandidateChannel {
  const normalized = normalizeAsciiToken(value);
  if (/(terminal|shipment|cargo|freight|route|storage|inventory|output|pipeline|운송|항로|재고|생산|터미널|선적|보관)/iu.test(normalized)) {
    return 'physical';
  }
  if (/(contract|agreement|deal|spa|purchase|장기계약|계약|합의)/iu.test(normalized)) {
    return 'contractual';
  }
  if (/(price|yield|spread|rate|bond|treasury|capital|funding|금리|환율|채권|자금)/iu.test(normalized)) {
    return 'financial';
  }
  if (/(policy|sanction|ceasefire|government|minister|regulation|정책|제재|정부|규제|외교)/iu.test(normalized)) {
    return 'political';
  }
  if (/(expectation|narrative|sentiment|전망|기대|내러티브|심리)/iu.test(normalized)) {
    return 'narrative';
  }
  return 'other';
}

export function inferObservationMetric(value: string): { metricKey: string; unit: string | null; valueText: string | null } {
  const normalized = normalizeAsciiToken(value);
  const unitMatch = value.match(NUMBER_WITH_UNIT_PATTERN);
  const valueText = unitMatch ? normalizeWorldModelText(unitMatch[0] ?? '') : null;
  const unit = unitMatch ? normalizeWorldModelText(unitMatch[2] ?? '') : null;

  if (/(freight|shipping rate|운임|해상운임)/iu.test(normalized)) return { metricKey: 'shipping_rate', unit, valueText };
  if (/(insurance|premium|보험료|보험)/iu.test(normalized)) return { metricKey: 'insurance_cost', unit, valueText };
  if (/(price|pricing|oil|gas|lng|원유|가스|가격)/iu.test(normalized)) return { metricKey: 'price_signal', unit, valueText };
  if (/(yield|rate|금리|수익률)/iu.test(normalized)) return { metricKey: 'rate_signal', unit, valueText };
  if (/(capacity|output|terminal|inventory|storage|수출|생산|가동률|재고|저장)/iu.test(normalized)) {
    return { metricKey: 'capacity_signal', unit, valueText };
  }
  return { metricKey: 'numeric_signal', unit, valueText };
}

export function extractWorldModelDateCandidate(value: string): string | null {
  const directMatch = value.match(ISO_DATE_PATTERN);
  if (directMatch) {
    const year = directMatch[1] ?? '';
    const month = (directMatch[2] ?? '').padStart(2, '0');
    const day = (directMatch[3] ?? '').padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function buildCanonicalSourceUrls(sources: Array<Pick<GroundingSource, 'url'>>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const source of sources) {
    const normalized = normalizeGroundingUrl(source.url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

export function mergeUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => normalizeWorldModelText(value)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}
