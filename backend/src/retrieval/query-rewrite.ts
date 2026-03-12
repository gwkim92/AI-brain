import { extractEntitySubject, type ResearchProfile } from './research-profile';

export type QueryRewriteInput = {
  prompt: string;
  maxVariants?: number;
  profile?: ResearchProfile;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.?!,;:]+$/u, '').trim();
}

function isAiInfraMarketPrompt(value: string): boolean {
  return /(ai|인공지능|infra|infrastructure|데이터센터|data center|gpu|반도체|semiconductor|hyperscaler|cloud)/iu.test(value);
}

export function generateQueryRewriteCandidates(input: QueryRewriteInput): string[] {
  const maxVariants = Math.max(1, Math.min(input.maxVariants ?? 4, 8));
  const base = normalizeWhitespace(stripTrailingPunctuation(input.prompt));
  if (!base) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(base);

  const profile = input.profile ?? 'entity_brief';
  const entitySubject = profile === 'entity_brief' ? extractEntitySubject(base) ?? base : null;
  const profileCandidates =
    profile === 'broad_news'
      ? [
          `${base} latest headlines`,
          `${base} world politics economy technology`,
          `${base} source links`,
          `${base} 최신 헤드라인`,
        ]
      : profile === 'topic_news'
        ? [
            `${base} latest updates timeline`,
            `${base} source links`,
            `${base} 최신 동향`,
            `${base} 최근 변화`,
          ]
        : profile === 'comparison_research'
          ? [
              `${base} compare differences`,
              `${base} official documentation comparison`,
              `${base} pricing api enterprise comparison`,
              `${base} developer experience integration comparison`,
              `${base} 장단점 비교`,
            ]
          : profile === 'repo_research'
            ? [
                `${base} GitHub README releases issues`,
                `${base} package registry docs`,
                `${base} 레포 README 릴리즈 이슈`,
              ]
            : profile === 'market_research'
              ? isAiInfraMarketPrompt(base)
                ? [
                    `${base} market outlook official release`,
                    `${base} 시장 동향 공식 발표`,
                    `AI infrastructure market demand capex`,
                    `AI infrastructure data center spending demand`,
                    `AI infrastructure semiconductor supply chain`,
                    `AI infrastructure market Reuters FT Bloomberg`,
                  ]
                : [
                    `${base} market outlook official release`,
                    `${base} Reuters Bloomberg FT`,
                    `${base} 시장 동향 공식 발표`,
                  ]
              : profile === 'policy_regulation'
                ? [
                    `${base} official policy guidance`,
                    `${base} regulation official notice`,
                    `${base} 공식 정책 규제 공지`,
                  ]
                : [
                    `${entitySubject ?? base} official site`,
                    `${entitySubject ?? base} investor relations newsroom`,
                    `${entitySubject ?? base} wikipedia overview`,
                    `${entitySubject ?? base} latest updates`,
                    `${entitySubject ?? base} 공식 사이트`,
                  ];

  for (const candidate of profileCandidates) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
    if (candidates.size >= maxVariants) {
      break;
    }
  }

  return Array.from(candidates).slice(0, maxVariants);
}
