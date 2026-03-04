import type { RetrievalAdapterV2 } from '../types';

const CROSSREF_ENDPOINT = 'https://api.crossref.org/works';

function toIsoDateFromParts(parts?: number[]): string | null {
  if (!parts || parts.length === 0) return null;
  const [year, month = 1, day = 1] = parts;
  if (!Number.isFinite(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function createCrossrefScholarAdapter(input: { mailto?: string }): RetrievalAdapterV2 {
  return {
    id: 'crossref_scholar',
    async query({ subQuery, maxItems }) {
      const params = new URLSearchParams({
        query: subQuery.text,
        rows: String(Math.max(1, Math.min(maxItems, 20)))
      });
      if (input.mailto) {
        params.set('mailto', input.mailto);
      }

      const response = await fetch(`${CROSSREF_ENDPOINT}?${params.toString()}`, {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`crossref_scholar_failed:${response.status}`);
      }

      const payload = (await response.json()) as {
        message?: {
          items?: Array<{
            URL?: string;
            DOI?: string;
            title?: string[];
            abstract?: string;
            'published-print'?: { 'date-parts'?: number[][] };
            issued?: { 'date-parts'?: number[][] };
          }>;
        };
      };

      const runKey = `crossref_scholar:${subQuery.id}`;
      const items = (payload.message?.items ?? [])
        .slice(0, maxItems)
        .map((item, index) => {
          const url = item.URL?.trim() || (item.DOI ? `https://doi.org/${item.DOI}` : '');
          if (!url) return null;
          const publishedAt = toIsoDateFromParts(
            item['published-print']?.['date-parts']?.[0] ?? item.issued?.['date-parts']?.[0]
          );
          return {
            runKey,
            subQueryId: subQuery.id,
            url,
            title: item.title?.[0]?.trim() || url,
            domain: extractDomain(url),
            snippet: item.abstract?.replace(/<[^>]+>/gu, '').slice(0, 500) ?? '',
            publishedAt,
            connector: 'crossref_scholar',
            rankScore: Number((1 - index * 0.03).toFixed(3)),
            metadata: {
              source: 'crossref_scholar',
              doi: item.DOI ?? null
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return { items };
    }
  };
}
