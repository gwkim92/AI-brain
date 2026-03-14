const FRED_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';

export type FredSeriesPoint = {
  date: string;
  value: number;
};

export async function fetchFredLatest(input: {
  apiKey?: string;
  seriesId: string;
}): Promise<FredSeriesPoint | null> {
  if (!input.apiKey) return null;

  const params = new URLSearchParams({
    series_id: input.seriesId,
    api_key: input.apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '1'
  });
  const response = await fetch(`${FRED_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`fred_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as {
    observations?: Array<{ date?: string; value?: string }>;
  };
  const observation = payload.observations?.[0];
  if (!observation?.date || observation.value == null) return null;
  const numericValue = Number.parseFloat(observation.value);
  if (!Number.isFinite(numericValue)) return null;
  return {
    date: observation.date,
    value: numericValue
  };
}
