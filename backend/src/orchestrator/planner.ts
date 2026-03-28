import { randomUUID } from 'node:crypto';

import type { ResolvedModelSelection } from '../providers/model-selection';
import { generateWithPreferenceRecovery } from '../providers/preference-recovery';
import type { ProviderRouter } from '../providers/router';
import type { ProviderCredentialsByProvider } from '../providers/types';
import { withAiInvocationTrace } from '../observability/ai-trace';
import type { AppEnv } from '../config/env';
import { createExecutionGraphFromPlan } from '../graph-runtime/graph';
import type { ExecutionGraphSpec, JarvisStore, MissionStepPattern } from '../store/types';

export type PlanStep = {
  id: string;
  type: MissionStepPattern;
  taskType: string;
  title: string;
  description: string;
  order: number;
  dependencies: string[];
  metadata?: Record<string, unknown>;
};

export type OrchestratorPlan = {
  title: string;
  objective: string;
  domain: string;
  graph: ExecutionGraphSpec;
  steps: PlanStep[];
};

const PLAN_SYSTEM_PROMPT = `You are JARVIS, an AI orchestration planner. Given a user request, generate a structured execution plan as a JSON object.

The plan should decompose the request into executable steps. Each step has a type (execution pattern) and a task_type (routing hint).

Execution patterns:
- llm_generate: Single AI generation task (code writing, analysis, summarization, data processing)
- council_debate: Multi-agent deliberation for complex decisions, research synthesis, risk assessment
- human_gate: Require human approval before proceeding (use before destructive or high-risk actions)
- tool_call: External tool or API invocation (set tool_name in metadata)
- sub_mission: Delegate to a nested sub-mission for complex sub-tasks

Task types (for AI routing): chat, execute, council, code, compute, long_run, high_risk, radar_review, upgrade_execution

Rules:
- Steps with the same order number run in parallel.
- Steps with higher order numbers depend on all steps with lower order numbers.
- Add a "human_gate" step before any high-risk or destructive actions.
- Keep the plan minimal — prefer fewer steps that accomplish the goal.
- Choose task_type based on the nature of the step content.

Respond with ONLY a valid JSON object in this exact format:
{
  "title": "Short plan title",
  "objective": "What this plan accomplishes",
  "domain": "code|research|finance|mixed",
  "steps": [
    {
      "id": "step-1",
      "type": "llm_generate|council_debate|human_gate|tool_call|sub_mission",
      "task_type": "code|execute|council|compute|chat|high_risk|radar_review",
      "title": "Step title",
      "description": "What this step does in detail",
      "order": 1,
      "dependencies": [],
      "metadata": {}
    }
  ]
}`;

function createStepUuid(usedIds: Set<string>): string {
  let candidate = randomUUID();
  while (usedIds.has(candidate)) {
    candidate = randomUUID();
  }
  usedIds.add(candidate);
  return candidate;
}

export async function generatePlan(
  prompt: string,
  providerRouter: ProviderRouter,
  credentialsByProvider?: ProviderCredentialsByProvider,
  options?: {
    provider?: 'auto' | 'openai' | 'gemini' | 'anthropic' | 'local';
    strictProvider?: boolean;
    model?: string;
    modelSelection?: ResolvedModelSelection;
    trace?: {
      store: JarvisStore;
      env: AppEnv;
      userId: string;
      traceId?: string;
    };
  }
): Promise<OrchestratorPlan> {
  const modelSelection: ResolvedModelSelection = options?.modelSelection ?? {
    featureKey: 'mission_plan_generation',
    provider: options?.provider ?? 'auto',
    strictProvider: options?.strictProvider ?? false,
    model: options?.model ?? null,
    source:
      typeof options?.provider !== 'undefined'
      || typeof options?.strictProvider !== 'undefined'
      || typeof options?.model !== 'undefined'
        ? 'request_override'
        : 'auto',
    preference: null
  };

  const run = () =>
    generateWithPreferenceRecovery({
      providerRouter,
      modelSelection,
      request: {
        prompt: `Generate an execution plan for the following request:\n\n${prompt}`,
        systemPrompt: PLAN_SYSTEM_PROMPT,
        provider: modelSelection.provider,
        strictProvider: modelSelection.strictProvider,
        model: modelSelection.model ?? undefined,
        credentialsByProvider,
        taskType: 'execute',
        temperature: 0.3,
        maxOutputTokens: 2000
      }
    });
  const result = options?.trace
    ? await withAiInvocationTrace({
        store: options.trace.store,
        env: options.trace.env,
        userId: options.trace.userId,
        featureKey: 'mission_plan_generation',
        taskType: 'execute',
        requestProvider: modelSelection.provider,
        requestModel: modelSelection.model ?? null,
        traceId: options.trace.traceId,
        contextRefs: {
          route: '/api/v1/missions/generate-plan'
        },
        run
      })
    : await run();

  return parsePlanFromLLMOutput(result.result.outputText);
}

export function parsePlanFromLLMOutput(output: string): OrchestratorPlan {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON plan from LLM output');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.title || !parsed.objective || !Array.isArray(parsed.steps)) {
    throw new Error('Invalid plan structure: missing title, objective, or steps');
  }

  const usedStepIds = new Set<string>();
  const idMap = new Map<string, string>();
  const parsedSteps = parsed.steps as Array<Record<string, unknown>>;

  const normalized = parsedSteps.map((step, index) => {
    const rawId = typeof step.id === 'string' && step.id.trim().length > 0 ? step.id.trim() : `step-${index + 1}`;
    const normalizedId = createStepUuid(usedStepIds);
    if (!idMap.has(rawId)) {
      idMap.set(rawId, normalizedId);
    }
    return {
      rawId,
      normalizedId,
      rawStep: step,
      index
    };
  });

  const steps: PlanStep[] = normalized.map(({ rawId, normalizedId, rawStep, index }) => {
    const rawDependencies = Array.isArray(rawStep.dependencies) ? rawStep.dependencies.map(String) : [];
    const dependencies = Array.from(
      new Set(
        rawDependencies
          .map((dependencyId) => idMap.get(dependencyId.trim()) ?? null)
          .filter((dependencyId): dependencyId is string => Boolean(dependencyId && dependencyId !== normalizedId))
      )
    );

    return {
      id: normalizedId,
      type: validateStepPattern(String(rawStep.type ?? 'llm_generate')),
      taskType: validateTaskType(String(rawStep.task_type ?? 'execute')),
      title: String(rawStep.title ?? `Step ${index + 1}`),
      description: String(rawStep.description ?? ''),
      order: typeof rawStep.order === 'number' ? rawStep.order : index + 1,
      dependencies,
      metadata: typeof rawStep.metadata === 'object' && rawStep.metadata !== null
        ? rawStep.metadata as Record<string, unknown>
        : rawId
        ? { raw_step_id: rawId }
        : undefined
    };
  });

  const graph = createExecutionGraphFromPlan({
    title: String(parsed.title),
    objective: String(parsed.objective),
    domain: String(parsed.domain ?? 'mixed'),
    steps: steps.map((step) => ({
      id: step.id,
      type: step.type,
      taskType: step.taskType,
      title: step.title,
      description: step.description,
      order: step.order,
      dependencies: step.dependencies,
      route: patternToRoute(step.type),
      metadata: step.metadata
    }))
  });

  return {
    title: String(parsed.title),
    objective: String(parsed.objective),
    domain: String(parsed.domain ?? 'mixed'),
    graph,
    steps
  };
}

function validateStepPattern(type: string): MissionStepPattern {
  const valid: MissionStepPattern[] = ['llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission'];
  if (valid.includes(type as MissionStepPattern)) return type as MissionStepPattern;

  const legacyMap: Record<string, MissionStepPattern> = {
    code: 'llm_generate',
    finance: 'llm_generate',
    news: 'llm_generate',
    execute: 'llm_generate',
    research: 'council_debate',
    approval: 'human_gate'
  };
  return legacyMap[type] ?? 'llm_generate';
}

function validateTaskType(taskType: string): string {
  const valid = ['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'];
  return valid.includes(taskType) ? taskType : 'execute';
}

export function planToMissionInput(plan: OrchestratorPlan, userId: string) {
  return {
    userId,
    title: plan.title,
    objective: plan.objective,
    domain: plan.domain as 'code' | 'research' | 'finance' | 'mixed',
    steps: plan.steps.map((step) => ({
      id: step.id,
      type: step.type,
      title: step.title,
      description: step.description,
      route: patternToRoute(step.type),
      status: 'pending' as const,
      order: step.order,
      taskType: step.taskType,
      metadata: step.metadata
    }))
  };
}

function patternToRoute(pattern: MissionStepPattern): string {
  switch (pattern) {
    case 'council_debate': return '/studio/research';
    case 'human_gate': return '/approvals';
    default: return '/mission';
  }
}
