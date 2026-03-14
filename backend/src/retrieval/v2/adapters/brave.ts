import type { RetrievalAdapterV2 } from '../types';

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

function extractDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function createBraveWebAdapter(input: { apiKey?: string }): RetrievalAdapterV2 {
  return {
    id: 'brave_web',
    async query({ subQuery, maxItems }) {
      if (!input.apiKey) {
        return { items: [] };
      }

      const params = new URLSearchParams({
        q: subQuery.text,
        count: String(Math.max(1, Math.min(maxItems, 20)))
      });

      const response = await fetch(`${BRAVE_ENDPOINT}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': input.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`brave_web_failed:${response.status}`);
      }

      const payload = (await response.json()) as {
        web?: {
          results?: Array<{
            url?: string;
            title?: string;
            description?: string;
            age?: string;
          }>;
        };
      };

      const runKey = `brave_web:${subQuery.id}`;
      const items = (payload.web?.results ?? [])
        .slice(0, maxItems)
        .map((item, index) => {
          const url = item.url?.trim() ?? '';
          if (!url) return null;
          return {
            runKey,
            subQueryId: subQuery.id,
            url,
            title: item.title?.trim() || url,
            domain: extractDomain(url),
            snippet: item.description?.trim() ?? '',
            publishedAt: null,
            connector: 'brave_web',
            rankScore: Number((1 - index * 0.03).toFixed(3)),
            metadata: {
              source: 'brave_web',
              age: item.age ?? null
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return { items };
    }
  };
}
