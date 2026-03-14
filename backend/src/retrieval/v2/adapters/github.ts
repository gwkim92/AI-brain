import type { RetrievalAdapterV2 } from '../types';

const GITHUB_SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';

export function createGitHubCodeAdapter(input: { token?: string }): RetrievalAdapterV2 {
  return {
    id: 'github_code',
    async query({ subQuery, maxItems }) {
      const params = new URLSearchParams({
        q: subQuery.text,
        sort: 'stars',
        order: 'desc',
        per_page: String(Math.max(1, Math.min(maxItems, 20)))
      });

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json'
      };
      if (input.token) {
        headers.Authorization = `Bearer ${input.token}`;
      }

      const response = await fetch(`${GITHUB_SEARCH_ENDPOINT}?${params.toString()}`, { headers });
      if (!response.ok) {
        throw new Error(`github_code_failed:${response.status}`);
      }

      const payload = (await response.json()) as {
        items?: Array<{
          html_url?: string;
          full_name?: string;
          description?: string;
          stargazers_count?: number;
          updated_at?: string;
          language?: string | null;
        }>;
      };

      const runKey = `github_code:${subQuery.id}`;
      const items = (payload.items ?? [])
        .slice(0, maxItems)
        .map((item, index) => {
          const url = item.html_url?.trim() ?? '';
          if (!url) return null;
          return {
            runKey,
            subQueryId: subQuery.id,
            url,
            title: item.full_name?.trim() || url,
            domain: 'github.com',
            snippet: item.description?.trim() ?? '',
            publishedAt: item.updated_at ?? null,
            connector: 'github_code',
            rankScore: Number((1 - index * 0.03).toFixed(3)),
            metadata: {
              source: 'github_code',
              stars: item.stargazers_count ?? null,
              language: item.language ?? null
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return { items };
    }
  };
}
