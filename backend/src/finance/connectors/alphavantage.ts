const ALPHAVANTAGE_ENDPOINT = 'https://www.alphavantage.co/query';

export type AlphaVantageQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  changePercent: number;
  latestTradingDay: string;
};

export async function fetchAlphaVantageQuote(input: {
  apiKey?: string;
  symbol: string;
}): Promise<AlphaVantageQuote | null> {
  if (!input.apiKey) return null;

  const params = new URLSearchParams({
    function: 'GLOBAL_QUOTE',
    symbol: input.symbol,
    apikey: input.apiKey
  });
  const response = await fetch(`${ALPHAVANTAGE_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`alphavantage_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as {
    'Global Quote'?: Record<string, string | undefined>;
  };
  const quote = payload['Global Quote'];
  if (!quote) return null;

  const price = Number.parseFloat(quote['05. price'] ?? '');
  const previousClose = Number.parseFloat(quote['08. previous close'] ?? '');
  const changePercentRaw = (quote['10. change percent'] ?? '').replace('%', '');
  const changePercent = Number.parseFloat(changePercentRaw);

  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || !Number.isFinite(changePercent)) {
    return null;
  }

  return {
    symbol: quote['01. symbol'] ?? input.symbol,
    price,
    previousClose,
    changePercent,
    latestTradingDay: quote['07. latest trading day'] ?? ''
  };
}
