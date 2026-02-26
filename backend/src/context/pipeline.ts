import { compileContext, type CandidateSegment, type ContextMode, type RankedSegment } from './compiler';
import type { JarvisStore, MemorySegmentRecord, AssistantContextEventRecord } from '../store/types';
import type { TaskMode } from '../store/types';

const TASK_TYPE_TO_CONTEXT_MODE: Record<string, ContextMode> = {
  chat: 'chat',
  execute: 'chat',
  council: 'council',
  code: 'code',
  compute: 'compute',
  long_run: 'chat',
  high_risk: 'chat',
  radar_review: 'chat',
  upgrade_execution: 'chat'
};

function toContextMode(taskType: string): ContextMode {
  return TASK_TYPE_TO_CONTEXT_MODE[taskType] ?? 'chat';
}

function segmentToCandidate(segment: MemorySegmentRecord, tier: MemoryTier): CandidateSegment {
  const estimatedTokens = Math.max(1, Math.ceil(segment.content.length / 4));
  const recency = computeRecencyScore(segment.createdAt);
  const tierBoost = tier === 'hot' ? 0.3 : tier === 'warm' ? 0.1 : 0;

  return {
    id: segment.id,
    tokenCount: estimatedTokens,
    evidenceScore: Math.min(1, segment.confidence + tierBoost),
    recencyScore: recency,
    reliabilityScore: segment.confidence,
    content: segment.content
  };
}

function eventToCandidate(event: AssistantContextEventRecord): CandidateSegment {
  const content = typeof event.data === 'object' && event.data !== null
    ? JSON.stringify(event.data)
    : String(event.data ?? '');
  const estimatedTokens = Math.max(1, Math.ceil(content.length / 4));

  return {
    id: event.id,
    tokenCount: estimatedTokens,
    evidenceScore: 0.9,
    recencyScore: 1.0,
    reliabilityScore: 0.95,
    content
  };
}

function computeRecencyScore(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) return 1.0;
  if (ageDays <= 7) return 0.8;
  if (ageDays <= 30) return 0.5;
  return 0.2;
}

export type MemoryTier = 'hot' | 'warm' | 'cold';

export const TIER_TOKEN_BUDGETS: Record<MemoryTier, number> = {
  hot: 2048,
  warm: 6144,
  cold: 4096
};

export type ContextPipelineInput = {
  userId: string;
  prompt: string;
  taskType: TaskMode | string;
  systemPrompt?: string;
  embeddingForSearch?: number[] | null;
  contextId?: string;
};

export type ContextPipelineResult = {
  enrichedPrompt: string;
  systemPrompt: string;
  contextMode: ContextMode;
  segmentsUsed: number;
  tokensUsed: number;
  tokenBudget: number;
  tierBreakdown: Record<MemoryTier, number>;
};

export async function runContextPipeline(
  store: JarvisStore,
  input: ContextPipelineInput
): Promise<ContextPipelineResult> {
  const contextMode = toContextMode(input.taskType);
  const baseSystem = input.systemPrompt ?? '';

  const allSelected: RankedSegment[] = [];
  let totalTokensUsed = 0;
  const tierBreakdown: Record<MemoryTier, number> = { hot: 0, warm: 0, cold: 0 };

  // Hot tier: current session context events
  if (input.contextId) {
    const events = await store.listAssistantContextEvents({
      userId: input.userId,
      contextId: input.contextId,
      limit: 20
    });
    const hotCandidates = events.map(eventToCandidate);
    if (hotCandidates.length > 0) {
      const hotCompiled = compileContext({
        mode: contextMode,
        candidates: hotCandidates,
        overrideTokenBudget: TIER_TOKEN_BUDGETS.hot
      });
      allSelected.push(...hotCompiled.selectedSegments);
      totalTokensUsed += hotCompiled.usedTokens;
      tierBreakdown.hot = hotCompiled.selectedSegments.length;
    }
  }

  // Warm tier: recent 7-day memory segments
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let warmSegments: MemorySegmentRecord[];

  if (input.embeddingForSearch && input.embeddingForSearch.length > 0) {
    warmSegments = (await store.searchMemoryByEmbedding({
      userId: input.userId,
      embedding: input.embeddingForSearch,
      limit: 15,
      minConfidence: 0.3
    })).filter((s) => s.createdAt >= sevenDaysAgo);
  } else {
    warmSegments = (await store.listMemorySegments({
      userId: input.userId,
      limit: 15
    })).filter((s) => s.createdAt >= sevenDaysAgo);
  }

  if (warmSegments.length > 0) {
    const warmCandidates = warmSegments.map((s) => segmentToCandidate(s, 'warm'));
    const warmCompiled = compileContext({
      mode: contextMode,
      candidates: warmCandidates,
      overrideTokenBudget: TIER_TOKEN_BUDGETS.warm
    });
    allSelected.push(...warmCompiled.selectedSegments);
    totalTokensUsed += warmCompiled.usedTokens;
    tierBreakdown.warm = warmCompiled.selectedSegments.length;
  }

  // Cold tier: all memory segments (beyond 7 days or lower confidence)
  let coldSegments: MemorySegmentRecord[];

  if (input.embeddingForSearch && input.embeddingForSearch.length > 0) {
    coldSegments = (await store.searchMemoryByEmbedding({
      userId: input.userId,
      embedding: input.embeddingForSearch,
      limit: 10,
      minConfidence: 0.5
    })).filter((s) => s.createdAt < sevenDaysAgo);
  } else {
    coldSegments = (await store.listMemorySegments({
      userId: input.userId,
      limit: 10
    })).filter((s) => s.createdAt < sevenDaysAgo);
  }

  if (coldSegments.length > 0) {
    const coldCandidates = coldSegments.map((s) => segmentToCandidate(s, 'cold'));
    const coldCompiled = compileContext({
      mode: contextMode,
      candidates: coldCandidates,
      overrideTokenBudget: TIER_TOKEN_BUDGETS.cold
    });
    allSelected.push(...coldCompiled.selectedSegments);
    totalTokensUsed += coldCompiled.usedTokens;
    tierBreakdown.cold = coldCompiled.selectedSegments.length;
  }

  const totalBudget = TIER_TOKEN_BUDGETS.hot + TIER_TOKEN_BUDGETS.warm + TIER_TOKEN_BUDGETS.cold;

  if (allSelected.length === 0) {
    return {
      enrichedPrompt: input.prompt,
      systemPrompt: baseSystem,
      contextMode,
      segmentsUsed: 0,
      tokensUsed: 0,
      tokenBudget: totalBudget,
      tierBreakdown
    };
  }

  const contextBlock = allSelected
    .map((s) => s.content)
    .join('\n---\n');

  const contextSection = `<relevant_context>\n${contextBlock}\n</relevant_context>`;
  const enrichedSystem = baseSystem
    ? `${baseSystem}\n\n${contextSection}`
    : contextSection;

  return {
    enrichedPrompt: input.prompt,
    systemPrompt: enrichedSystem,
    contextMode,
    segmentsUsed: allSelected.length,
    tokensUsed: totalTokensUsed,
    tokenBudget: totalBudget,
    tierBreakdown
  };
}
