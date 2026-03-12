import type { RadarFeedSourceRecord, RadarSourceTier, RadarSourceType } from '../store/types';

type RadarFeedSourceSeed = Omit<
  RadarFeedSourceRecord,
  'lastFetchedAt' | 'lastSuccessAt' | 'lastError' | 'createdAt' | 'updatedAt'
>;

function sourceSeed(input: {
  id: string;
  name: string;
  kind: RadarFeedSourceRecord['kind'];
  url: string;
  sourceType: RadarSourceType;
  sourceTier: RadarSourceTier;
  pollMinutes: number;
  enabled?: boolean;
  parserHints?: Record<string, unknown>;
  entityHints?: string[];
  metricHints?: string[];
}): RadarFeedSourceSeed {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    url: input.url,
    sourceType: input.sourceType,
    sourceTier: input.sourceTier,
    pollMinutes: input.pollMinutes,
    enabled: input.enabled ?? true,
    parserHints: { ...(input.parserHints ?? {}) },
    entityHints: [...(input.entityHints ?? [])],
    metricHints: [...(input.metricHints ?? [])],
  };
}

export const DEFAULT_RADAR_FEED_SOURCES: RadarFeedSourceSeed[] = [
  sourceSeed({
    id: 'sec_press_releases',
    name: 'SEC Press Releases',
    kind: 'rss',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    sourceType: 'filing',
    sourceTier: 'tier_0',
    pollMinutes: 30,
    entityHints: ['SEC'],
    metricHints: ['filing'],
  }),
  sourceSeed({
    id: 'fed_press_all',
    name: 'Federal Reserve Press Releases',
    kind: 'rss',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    sourceType: 'policy',
    sourceTier: 'tier_0',
    pollMinutes: 30,
    entityHints: ['Fed', 'Federal Reserve'],
    metricHints: ['yield', 'rate', 'inflation'],
  }),
  sourceSeed({
    id: 'openai_news',
    name: 'OpenAI News',
    kind: 'rss',
    url: 'https://openai.com/news/rss.xml',
    sourceType: 'news',
    sourceTier: 'tier_1',
    pollMinutes: 60,
    entityHints: ['OpenAI'],
    metricHints: ['platform', 'policy'],
  }),
  sourceSeed({
    id: 'google_ai_blog',
    name: 'Google AI Blog',
    kind: 'rss',
    url: 'https://blog.google/technology/ai/rss/',
    sourceType: 'blog',
    sourceTier: 'tier_2',
    pollMinutes: 90,
    entityHints: ['Google'],
    metricHints: ['platform', 'policy'],
  }),
  sourceSeed({
    id: 'hn_ai_forum',
    name: 'Hacker News AI Search',
    kind: 'json',
    url: 'https://hn.algolia.com/api/v1/search_by_date?query=ai&tags=story',
    sourceType: 'forum',
    sourceTier: 'tier_3',
    pollMinutes: 20,
    parserHints: {
      itemsPath: 'hits',
      titleField: 'title',
      summaryField: 'story_text',
      urlField: 'url',
      publishedAtField: 'created_at',
      entityHintField: 'author',
    },
  }),
  sourceSeed({
    id: 'reddit_artificial',
    name: 'Reddit r/artificial',
    kind: 'rss',
    url: 'https://www.reddit.com/r/artificial/.rss',
    sourceType: 'social',
    sourceTier: 'tier_3',
    pollMinutes: 20,
    entityHints: ['AI'],
  }),
  sourceSeed({
    id: 'ops_runtime_policy',
    name: 'Ops Runtime Policy',
    kind: 'synthetic',
    url: 'ops://runtime-policy',
    sourceType: 'ops_policy',
    sourceTier: 'tier_0',
    pollMinutes: 60,
    parserHints: {
      synthetic: 'ops_policy',
    },
  }),
];

export function listDefaultRadarFeedSources(): RadarFeedSourceSeed[] {
  return DEFAULT_RADAR_FEED_SOURCES.map((source) => ({
    ...source,
    parserHints: { ...source.parserHints },
    entityHints: [...source.entityHints],
    metricHints: [...source.metricHints],
  }));
}
