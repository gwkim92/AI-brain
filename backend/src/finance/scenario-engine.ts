export type PortfolioPositionInput = {
  symbol: string;
  quantity: number;
  price: number;
  assetClass?: 'equity' | 'bond' | 'fx' | 'commodity' | 'crypto';
};

export type ScenarioType = 'rate_up_100bp' | 'rate_down_100bp' | 'fx_usd_up_5pct' | 'commodity_up_10pct';

export type ScenarioRunResult = {
  scenarioType: ScenarioType;
  shockedPortfolioValue: number;
  baselinePortfolioValue: number;
  estimatedPnl: number;
  shockedBySymbol: Array<{
    symbol: string;
    baselineValue: number;
    shockedValue: number;
    pnl: number;
  }>;
};

const DEFAULT_ASSET_CLASS: NonNullable<PortfolioPositionInput['assetClass']> = 'equity';

function shockByScenario(scenarioType: ScenarioType, assetClass: NonNullable<PortfolioPositionInput['assetClass']>): number {
  if (scenarioType === 'rate_up_100bp') {
    if (assetClass === 'bond') return -0.08;
    if (assetClass === 'equity') return -0.04;
    return -0.02;
  }
  if (scenarioType === 'rate_down_100bp') {
    if (assetClass === 'bond') return 0.07;
    if (assetClass === 'equity') return 0.03;
    return 0.01;
  }
  if (scenarioType === 'fx_usd_up_5pct') {
    if (assetClass === 'fx') return 0.05;
    if (assetClass === 'commodity') return -0.03;
    return -0.01;
  }
  if (assetClass === 'commodity') return 0.1;
  return 0.02;
}

export function runFinanceScenario(input: {
  scenarioType: ScenarioType;
  positions: PortfolioPositionInput[];
}): ScenarioRunResult {
  const shockedBySymbol = input.positions.map((position) => {
    const baselineValue = position.quantity * position.price;
    const shock = shockByScenario(input.scenarioType, position.assetClass ?? DEFAULT_ASSET_CLASS);
    const shockedValue = baselineValue * (1 + shock);
    return {
      symbol: position.symbol,
      baselineValue: Number(baselineValue.toFixed(4)),
      shockedValue: Number(shockedValue.toFixed(4)),
      pnl: Number((shockedValue - baselineValue).toFixed(4))
    };
  });

  const baselinePortfolioValue = shockedBySymbol.reduce((sum, item) => sum + item.baselineValue, 0);
  const shockedPortfolioValue = shockedBySymbol.reduce((sum, item) => sum + item.shockedValue, 0);

  return {
    scenarioType: input.scenarioType,
    shockedPortfolioValue: Number(shockedPortfolioValue.toFixed(4)),
    baselinePortfolioValue: Number(baselinePortfolioValue.toFixed(4)),
    estimatedPnl: Number((shockedPortfolioValue - baselinePortfolioValue).toFixed(4)),
    shockedBySymbol
  };
}
