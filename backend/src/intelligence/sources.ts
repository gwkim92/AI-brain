import type {
  CreateIntelligenceSourceInput,
  IntelligenceSourceKind,
  IntelligenceSourceTier,
  IntelligenceSourceType,
  JarvisStore,
} from '../store/types';

type IntelligenceSourceSeed = Omit<CreateIntelligenceSourceInput, 'workspaceId'>;

function seed(input: {
  name: string;
  kind: IntelligenceSourceKind;
  url: string;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  pollMinutes: number;
  parserConfigJson?: Record<string, unknown>;
  crawlConfigJson?: Record<string, unknown>;
  entityHints?: string[];
  metricHints?: string[];
}): IntelligenceSourceSeed {
  return {
    name: input.name,
    kind: input.kind,
    url: input.url,
    sourceType: input.sourceType,
    sourceTier: input.sourceTier,
    pollMinutes: input.pollMinutes,
    enabled: true,
    parserConfigJson: { ...(input.parserConfigJson ?? {}) },
    crawlConfigJson: { ...(input.crawlConfigJson ?? {}) },
    entityHints: [...(input.entityHints ?? [])],
    metricHints: [...(input.metricHints ?? [])],
  };
}

export const DEFAULT_INTELLIGENCE_SOURCE_SEEDS: IntelligenceSourceSeed[] = [
  seed({
    name: 'Federal Reserve Press Releases',
    kind: 'rss',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    sourceType: 'policy',
    sourceTier: 'tier_0',
    pollMinutes: 30,
    entityHints: ['Federal Reserve', 'Fed'],
    metricHints: ['rates', 'inflation', 'yield'],
  }),
  seed({
    name: 'SEC Press Releases',
    kind: 'rss',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    sourceType: 'filing',
    sourceTier: 'tier_0',
    pollMinutes: 30,
    entityHints: ['SEC'],
    metricHints: ['filing'],
  }),
  seed({
    name: 'OpenAI News',
    kind: 'rss',
    url: 'https://openai.com/news/rss.xml',
    sourceType: 'news',
    sourceTier: 'tier_1',
    pollMinutes: 60,
    entityHints: ['OpenAI'],
    metricHints: ['platform', 'policy', 'model'],
  }),
  seed({
    name: 'Google AI Blog',
    kind: 'rss',
    url: 'https://blog.google/technology/ai/rss/',
    sourceType: 'blog',
    sourceTier: 'tier_2',
    pollMinutes: 90,
    entityHints: ['Google'],
    metricHints: ['platform', 'policy', 'model'],
  }),
  seed({
    name: 'Hacker News AI Search',
    kind: 'json',
    url: 'https://hn.algolia.com/api/v1/search_by_date?query=ai&tags=story',
    sourceType: 'forum',
    sourceTier: 'tier_3',
    pollMinutes: 20,
    parserConfigJson: {
      itemsPath: 'hits',
      titleField: 'title',
      summaryField: 'story_text',
      urlField: 'url',
      publishedAtField: 'created_at',
      entityHintField: 'author',
    },
  }),
  seed({
    name: 'Reddit r/artificial',
    kind: 'rss',
    url: 'https://www.reddit.com/r/artificial/.rss',
    sourceType: 'social',
    sourceTier: 'tier_3',
    pollMinutes: 20,
    entityHints: ['AI'],
  }),
  seed({
    name: 'MCP Specification',
    kind: 'headless',
    url: 'https://modelcontextprotocol.io/specification',
    sourceType: 'web_page',
    sourceTier: 'tier_1',
    pollMinutes: 180,
    entityHints: ['MCP'],
    metricHints: ['spec', 'protocol'],
    crawlConfigJson: {
      allowDomains: ['modelcontextprotocol.io'],
      depthBudget: 1,
    },
  }),
];

export function listDefaultIntelligenceSourceSeeds(): IntelligenceSourceSeed[] {
  return DEFAULT_INTELLIGENCE_SOURCE_SEEDS.map((row) => ({
    ...row,
    parserConfigJson: { ...(row.parserConfigJson ?? {}) },
    crawlConfigJson: { ...(row.crawlConfigJson ?? {}) },
    entityHints: [...(row.entityHints ?? [])],
    metricHints: [...(row.metricHints ?? [])],
  }));
}

export async function ensureDefaultIntelligenceSources(input: {
  store: Pick<JarvisStore, 'listIntelligenceSources' | 'createIntelligenceSource'>;
  workspaceId: string;
}): Promise<void> {
  const existing = await input.store.listIntelligenceSources({
    workspaceId: input.workspaceId,
    limit: 200,
  });
  if (existing.length > 0) {
    return;
  }

  const seeds = listDefaultIntelligenceSourceSeeds();
  for (const source of seeds) {
    await input.store.createIntelligenceSource({
      workspaceId: input.workspaceId,
      ...source,
    });
  }
}
