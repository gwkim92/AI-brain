import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { evaluateAdvisoryLiteCompliance } from '../../finance/compliance';
import { fetchAlphaVantageQuote } from '../../finance/connectors/alphavantage';
import { fetchFredLatest } from '../../finance/connectors/fred';
import { fetchSecRecentFilings } from '../../finance/connectors/sec';
import { runFinanceScenario } from '../../finance/scenario-engine';
import { sendError, sendSuccess } from '../../lib/http';
import type { V2RouteContext } from './types';

const FinanceResearchSchema = z.object({
  query: z.string().min(1).max(12000),
  symbol: z.string().min(1).max(32).optional(),
  cik: z.string().min(1).max(20).optional(),
  evidence_count: z.number().int().min(0).max(1000).default(0),
  draft: z.string().min(1).max(12000).optional()
});

const FinanceScenarioSchema = z.object({
  scenario_type: z.enum(['rate_up_100bp', 'rate_down_100bp', 'fx_usd_up_5pct', 'commodity_up_10pct']),
  positions: z
    .array(
      z.object({
        symbol: z.string().min(1).max(30),
        quantity: z.number(),
        price: z.number(),
        assetClass: z.enum(['equity', 'bond', 'fx', 'commodity', 'crypto']).optional()
      })
    )
    .max(500)
});

const ComplianceCheckSchema = z.object({
  draft: z.string().min(1).max(12000),
  evidence_count: z.number().int().min(0).max(1000)
});

const portfolioStateByUser = new Map<string, { positions: z.infer<typeof FinanceScenarioSchema>['positions']; updatedAt: string }>();

export async function registerV2FinanceRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/finance/research', async (request, reply) => {
    if (!ctx.v2Flags.financeEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 finance is disabled');
    }

    const parsed = FinanceResearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid finance research payload', parsed.error.flatten());
    }

    const [quote, fedFunds, secFilings] = await Promise.all([
      parsed.data.symbol
        ? fetchAlphaVantageQuote({
            apiKey: ctx.env.ALPHAVANTAGE_API_KEY,
            symbol: parsed.data.symbol
          })
        : Promise.resolve(null),
      fetchFredLatest({
        apiKey: ctx.env.FRED_API_KEY,
        seriesId: 'FEDFUNDS'
      }).catch(() => null),
      parsed.data.cik
        ? fetchSecRecentFilings({
            cik: parsed.data.cik,
            userAgent: ctx.env.SEC_USER_AGENT
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    const connectorEvidenceCount =
      (quote ? 1 : 0) + (fedFunds ? 1 : 0) + (secFilings.length > 0 ? 1 : 0) + parsed.data.evidence_count;
    const draft =
      parsed.data.draft ??
      [
        `Query: ${parsed.data.query}`,
        quote ? `Quote(${quote.symbol})=${quote.price} (${quote.changePercent}%)` : null,
        fedFunds ? `FEDFUNDS=${fedFunds.value} @ ${fedFunds.date}` : null,
        secFilings.length > 0 ? `Recent SEC forms: ${secFilings.slice(0, 3).map((item) => item.form).join(', ')}` : null
      ]
        .filter(Boolean)
        .join('\n');
    const compliance = evaluateAdvisoryLiteCompliance({
      draft,
      evidenceCount: connectorEvidenceCount
    });

    return sendSuccess(reply, request, 200, {
      query: parsed.data.query,
      evidence_count: connectorEvidenceCount,
      connectors: {
        alphavantage_quote: quote,
        fred_series: fedFunds,
        sec_filings: secFilings.slice(0, 5)
      },
      compliance: {
        decision: compliance.decision,
        reason_codes: compliance.reasonCodes
      },
      draft: compliance.sanitizedDraft
    });
  });

  app.post('/api/v2/finance/scenarios', async (request, reply) => {
    if (!ctx.v2Flags.financeEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 finance is disabled');
    }

    const parsed = FinanceScenarioSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid finance scenario payload', parsed.error.flatten());
    }

    const result = runFinanceScenario({
      scenarioType: parsed.data.scenario_type,
      positions: parsed.data.positions
    });
    const userId = ctx.resolveRequestUserId(request);
    portfolioStateByUser.set(userId, {
      positions: parsed.data.positions,
      updatedAt: new Date().toISOString()
    });

    return sendSuccess(reply, request, 200, {
      scenario: result
    });
  });

  app.get('/api/v2/finance/portfolio-state', async (request, reply) => {
    if (!ctx.v2Flags.financeEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 finance is disabled');
    }

    const userId = ctx.resolveRequestUserId(request);
    const state = portfolioStateByUser.get(userId) ?? {
      positions: [],
      updatedAt: null
    };

    return sendSuccess(reply, request, 200, {
      positions: state.positions,
      updated_at: state.updatedAt
    });
  });

  app.post('/api/v2/finance/compliance/check', async (request, reply) => {
    if (!ctx.v2Flags.financeEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 finance is disabled');
    }

    const parsed = ComplianceCheckSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid finance compliance payload', parsed.error.flatten());
    }

    const result = evaluateAdvisoryLiteCompliance({
      draft: parsed.data.draft,
      evidenceCount: parsed.data.evidence_count
    });

    return sendSuccess(reply, request, 200, {
      decision: result.decision,
      reason_codes: result.reasonCodes,
      sanitized_draft: result.sanitizedDraft
    });
  });
}
