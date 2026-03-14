import { z } from 'zod';

import type { ProviderRouter } from '../providers/router';
import type { V2RiskLevel, V2RoutingComplexity, V2RoutingIntent } from '../store/types';

const SemanticRouterSchema = z.object({
  intent: z.enum(['code', 'research', 'finance', 'news', 'general']).default('general'),
  complexity: z.enum(['simple', 'moderate', 'complex']).default('simple'),
  goal: z.string().min(1).max(1000),
  success_criteria: z.array(z.string().min(1).max(500)).max(8).default([]),
  constraints: z.record(z.string(), z.unknown()).default({}),
  risk: z.object({
    level: z.enum(['low', 'medium', 'high']).default('low'),
    reasons: z.array(z.string().min(1).max(200)).max(8).default([])
  }),
  deliverables: z
    .array(
      z.object({
        type: z.string().min(1).max(80),
        format: z.string().min(1).max(80)
      })
    )
    .max(8)
    .default([]),
  confidence: z.object({
    intent: z.number().min(0).max(1).default(0.5),
    contract: z.number().min(0).max(1).default(0.5)
  }),
  clarifying_questions: z.array(z.string().min(1).max(300)).max(2).default([])
});

export type SemanticRoutingResult = {
  intent: V2RoutingIntent;
  complexity: V2RoutingComplexity;
  goal: string;
  successCriteria: string[];
  constraints: Record<string, unknown>;
  risk: {
    level: V2RiskLevel;
    reasons: string[];
  };
  deliverables: Array<{ type: string; format: string }>;
  confidence: {
    intent: number;
    contract: number;
  };
  clarifyingQuestions: string[];
};

function extractJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/u);
  return match?.[0] ?? null;
}

export async function runSemanticRouter(
  providerRouter: ProviderRouter,
  prompt: string
): Promise<SemanticRoutingResult | null> {
  try {
    const routed = await providerRouter.generate({
      prompt: `User request:\n${prompt}`,
      systemPrompt: [
        'Return only valid JSON.',
        'Infer task intent/complexity and compile execution contract fields.',
        'Schema:',
        '{',
        '  "intent":"code|research|finance|news|general",',
        '  "complexity":"simple|moderate|complex",',
        '  "goal":"...",',
        '  "success_criteria":["..."],',
        '  "constraints":{},',
        '  "risk":{"level":"low|medium|high","reasons":["..."]},',
        '  "deliverables":[{"type":"...","format":"..."}],',
        '  "confidence":{"intent":0.0,"contract":0.0},',
        '  "clarifying_questions":["optional up to 2"]',
        '}'
      ].join('\n'),
      taskType: 'execute',
      temperature: 0.1,
      maxOutputTokens: 800
    });

    const jsonText = extractJsonObject(routed.result.outputText);
    if (!jsonText) {
      return null;
    }
    const parsed = SemanticRouterSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return null;
    }

    return {
      intent: parsed.data.intent,
      complexity: parsed.data.complexity,
      goal: parsed.data.goal,
      successCriteria: parsed.data.success_criteria,
      constraints: parsed.data.constraints,
      risk: parsed.data.risk,
      deliverables: parsed.data.deliverables,
      confidence: parsed.data.confidence,
      clarifyingQuestions: parsed.data.clarifying_questions
    };
  } catch {
    return null;
  }
}
