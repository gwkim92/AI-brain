import { runDag, type DagStep } from './dag-runner';
import type { JarvisStore, MissionRecord, MissionStepRecord, MissionStepStatus, MissionStepType } from '../store/types';
import type { ProviderRouter } from '../providers/router';
import type { RoutingTaskType } from '../providers/types';
import { runContextPipeline } from '../context/pipeline';
import { embedAndStore } from '../memory/embed';

export type MissionExecutionCallbacks = {
  onStepStarted?: (stepId: string) => void | Promise<void>;
  onStepCompleted?: (stepId: string, result: unknown) => void | Promise<void>;
  onStepFailed?: (stepId: string, error: string) => void | Promise<void>;
};

function inferDependencies(step: MissionStepRecord, allSteps: MissionStepRecord[]): string[] {
  const preceding = allSteps
    .filter((s) => s.order < step.order)
    .sort((a, b) => b.order - a.order);

  if (preceding.length === 0) return [];

  const maxPrecedingOrder = preceding[0]!.order;
  return preceding
    .filter((s) => s.order === maxPrecedingOrder)
    .map((s) => s.id);
}

function resolveStepPattern(step: MissionStepRecord): 'llm_generate' | 'council_debate' | 'human_gate' | 'tool_call' | 'sub_mission' {
  switch (step.type) {
    case 'llm_generate':
    case 'council_debate':
    case 'human_gate':
    case 'tool_call':
    case 'sub_mission':
      return step.type;

    case 'code':
    case 'finance':
    case 'news':
    case 'execute':
      return 'llm_generate';

    case 'research':
      return 'council_debate';

    case 'approval':
      return 'human_gate';

    default:
      return 'llm_generate';
  }
}

function resolveTaskType(step: MissionStepRecord): RoutingTaskType {
  if (step.taskType) {
    const valid: RoutingTaskType[] = ['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'];
    if (valid.includes(step.taskType as RoutingTaskType)) {
      return step.taskType as RoutingTaskType;
    }
  }

  switch (step.type) {
    case 'code':
      return 'code';
    case 'research':
    case 'council_debate':
      return 'council';
    default:
      return 'execute';
  }
}

async function executeStep(
  step: MissionStepRecord,
  dependencyResults: Record<string, unknown>,
  store: JarvisStore,
  providerRouter: ProviderRouter,
  userId: string
): Promise<unknown> {
  const contextSummary = Object.entries(dependencyResults)
    .map(([id, result]) => `[Step ${id}]: ${typeof result === 'string' ? result : JSON.stringify(result)}`)
    .join('\n');

  const prompt = contextSummary
    ? `${step.description}\n\nPrevious step results:\n${contextSummary}`
    : step.description;

  const pattern = resolveStepPattern(step);
  const taskType = resolveTaskType(step);

  switch (pattern) {
    case 'llm_generate': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType });
      const result = await providerRouter.generate({
        prompt: ctx.enrichedPrompt,
        systemPrompt: ctx.systemPrompt || undefined,
        taskType
      });
      return result.result.outputText;
    }

    case 'council_debate': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'council' });
      const result = await providerRouter.generate({
        prompt: ctx.enrichedPrompt,
        systemPrompt: ctx.systemPrompt || undefined,
        taskType: 'council'
      });
      return result.result.outputText;
    }

    case 'human_gate': {
      return { status: 'approval_required', step_id: step.id, title: step.title };
    }

    case 'tool_call': {
      const toolName = step.metadata?.tool_name as string | undefined;
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'execute' });
      const result = await providerRouter.generate({
        prompt: toolName
          ? `Execute tool "${toolName}" with the following context:\n\n${ctx.enrichedPrompt}`
          : ctx.enrichedPrompt,
        systemPrompt: ctx.systemPrompt || undefined,
        taskType: 'execute'
      });
      return result.result.outputText;
    }

    case 'sub_mission': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'execute' });
      const result = await providerRouter.generate({
        prompt: ctx.enrichedPrompt,
        systemPrompt: ctx.systemPrompt || undefined,
        taskType: 'execute'
      });
      return result.result.outputText;
    }

    default:
      throw new Error(`Unknown step pattern: ${pattern}`);
  }
}

export async function executeMission(
  mission: MissionRecord,
  store: JarvisStore,
  providerRouter: ProviderRouter,
  userId: string,
  callbacks?: MissionExecutionCallbacks
): Promise<{ success: boolean; results: Record<string, unknown>; completedOrder: string[] }> {
  const steps = [...mission.steps].sort((a, b) => a.order - b.order);

  await store.updateMission({
    missionId: mission.id,
    userId,
    status: 'running'
  });

  const dagSteps: DagStep[] = steps.map((step) => ({
    id: step.id,
    dependencies: inferDependencies(step, steps),
    run: async (ctx) => {
      await updateStepStatus(store, mission, userId, step.id, 'running');
      await callbacks?.onStepStarted?.(step.id);

      try {
        const pattern = resolveStepPattern(step);
        if (pattern === 'human_gate') {
          await updateStepStatus(store, mission, userId, step.id, 'blocked');
          return { status: 'approval_required', step_id: step.id };
        }

        const result = await executeStep(step, ctx.dependencyResults, store, providerRouter, userId);
        await updateStepStatus(store, mission, userId, step.id, 'done');
        await callbacks?.onStepCompleted?.(step.id, result);

        if (typeof result === 'string' && result.length > 0) {
          void embedAndStore(store, null, {
            userId,
            content: `Mission step [${step.title}]: ${result}`,
            segmentType: 'mission_step_result',
            taskId: mission.id,
            confidence: 0.7,
          }).catch(() => undefined);
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await updateStepStatus(store, mission, userId, step.id, 'failed');
        await callbacks?.onStepFailed?.(step.id, errorMsg);
        throw err;
      }
    }
  }));

  try {
    const result = await runDag(dagSteps, { maxConcurrency: 4, failFast: false });

    const allDone = steps.every((s) => {
      const stepResult = result.results[s.id];
      const pattern = resolveStepPattern(s);
      return stepResult !== undefined || pattern === 'human_gate';
    });

    await store.updateMission({
      missionId: mission.id,
      userId,
      status: allDone ? 'completed' : 'blocked'
    });

    return { success: allDone, results: result.results, completedOrder: result.completedOrder };
  } catch (err) {
    await store.updateMission({
      missionId: mission.id,
      userId,
      status: 'failed'
    });

    throw err;
  }
}

async function updateStepStatus(
  store: JarvisStore,
  mission: MissionRecord,
  userId: string,
  stepId: string,
  status: MissionStepStatus
): Promise<void> {
  await store.updateMission({
    missionId: mission.id,
    userId,
    stepStatuses: [{ stepId, status }]
  });
}
