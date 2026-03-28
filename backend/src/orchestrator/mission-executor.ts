import type { AppEnv } from '../config/env';
import { GraphCallbackRegistry } from '../graph-runtime/callbacks';
import { executeExecutionGraph, GraphExecutionHalt } from '../graph-runtime/executor';
import { createMissionExecutionGraph } from '../graph-runtime/graph';
import type { GraphRunRecord, JarvisStore, MissionRecord, MissionStepRecord, MissionStepStatus, ToolInvocation } from '../store/types';
import type { ProviderRouter } from '../providers/router';
import type { ProviderCredentialsByProvider, RoutingTaskType } from '../providers/types';
import { runContextPipeline } from '../context/pipeline';
import { embedAndStore } from '../memory/embed';
import { resolveModelSelection, type ResolvedModelSelection } from '../providers/model-selection';
import { generateWithPreferenceRecovery } from '../providers/preference-recovery';
import { withAiInvocationTrace } from '../observability/ai-trace';
import type { ModelSelectionOverrideInput } from '../providers/model-selection';
import { evaluateToolInvocationPolicy } from '../tools/gateway';

export type MissionExecutionCallbacks = {
  onStepStarted?: (stepId: string) => void | Promise<void>;
  onStepCompleted?: (stepId: string, result: unknown) => void | Promise<void>;
  onStepFailed?: (stepId: string, error: string) => void | Promise<void>;
};

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
  env: AppEnv,
  providerRouter: ProviderRouter,
  missionId: string,
  userId: string,
  modelSelectionOverride?: ModelSelectionOverrideInput,
  resolvedModelSelection?: ResolvedModelSelection,
  credentialsByProvider?: ProviderCredentialsByProvider
): Promise<unknown> {
  const contextSummary = Object.entries(dependencyResults)
    .map(([id, result]) => `[Step ${id}]: ${typeof result === 'string' ? result : JSON.stringify(result)}`)
    .join('\n');

  const prompt = contextSummary
    ? `${step.description}\n\nPrevious step results:\n${contextSummary}`
    : step.description;

  const pattern = resolveStepPattern(step);
  const taskType = resolveTaskType(step);
  const modelSelection = resolvedModelSelection ?? await resolveModelSelection({
    store,
    userId,
    featureKey: 'mission_execute_step',
    override: modelSelectionOverride
  });

  const runWithTrace = (prompt: string, systemPrompt: string | undefined, resolvedTaskType: RoutingTaskType) =>
    withAiInvocationTrace({
      store,
      env,
      userId,
      featureKey: 'mission_execute_step',
      taskType: resolvedTaskType,
      requestProvider: modelSelection.provider,
      requestModel: modelSelection.model,
      traceId: missionId,
      contextRefs: {
        mission_id: missionId,
        mission_step_id: step.id,
        mission_step_type: step.type,
        task_type: resolvedTaskType,
        model_selection_source: modelSelection.source
      },
      run: () =>
        generateWithPreferenceRecovery({
          providerRouter,
          modelSelection,
          request: {
            prompt,
            systemPrompt,
            provider: modelSelection.provider,
            strictProvider: modelSelection.strictProvider,
            model: modelSelection.model ?? undefined,
            credentialsByProvider,
            taskType: resolvedTaskType
          }
        })
    });

  switch (pattern) {
    case 'llm_generate': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType });
      const result = await runWithTrace(ctx.enrichedPrompt, ctx.systemPrompt || undefined, taskType);
      return result.result.outputText;
    }

    case 'council_debate': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'council' });
      const result = await runWithTrace(ctx.enrichedPrompt, ctx.systemPrompt || undefined, 'council');
      return result.result.outputText;
    }

    case 'human_gate': {
      return { status: 'approval_required', step_id: step.id, title: step.title };
    }

    case 'tool_call': {
      const toolName = step.metadata?.tool_name as string | undefined;
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'execute' });
      const result = await runWithTrace(
        toolName
          ? `Execute tool "${toolName}" with the following context:\n\n${ctx.enrichedPrompt}`
          : ctx.enrichedPrompt,
        ctx.systemPrompt || undefined,
        'execute'
      );
      return result.result.outputText;
    }

    case 'sub_mission': {
      const ctx = await runContextPipeline(store, { userId, prompt, taskType: 'execute' });
      const result = await runWithTrace(ctx.enrichedPrompt, ctx.systemPrompt || undefined, 'execute');
      return result.result.outputText;
    }

    default:
      throw new Error(`Unknown step pattern: ${pattern}`);
  }
}

function shouldPromoteMissionResult(step: MissionStepRecord): boolean {
  return step.metadata?.promote_memory === true || step.metadata?.memory_promotion === true;
}

function buildMissionToolInvocation(step: MissionStepRecord): ToolInvocation {
  return {
    source:
      step.metadata?.tool_source === 'mcp' || step.metadata?.tool_source === 'openapi'
        ? step.metadata.tool_source
        : 'internal',
    name:
      typeof step.metadata?.tool_name === 'string' && step.metadata.tool_name.trim().length > 0
        ? step.metadata.tool_name
        : `mission.${step.id}`,
    metadata: {
      ...step.metadata,
      mission_step_id: step.id,
      mission_step_type: step.type
    }
  };
}

export async function executeMission(
  mission: MissionRecord,
  store: JarvisStore,
  env: AppEnv,
  providerRouter: ProviderRouter,
  userId: string,
  callbacks?: MissionExecutionCallbacks,
  options?: {
    modelSelectionOverride?: ModelSelectionOverrideInput;
    resolvedModelSelection?: ResolvedModelSelection;
  },
  credentialsByProvider?: ProviderCredentialsByProvider
): Promise<{ success: boolean; results: Record<string, unknown>; completedOrder: string[]; graphRun: GraphRunRecord }> {
  const graph = createMissionExecutionGraph(mission);
  const stepsByNodeId = new Map(graph.nodes.map((node) => [node.id, mission.steps.find((step) => step.id === node.id) ?? null]));

  await store.updateMission({
    missionId: mission.id,
    userId,
    status: 'running'
  });

  const graphCallbacks = new GraphCallbackRegistry();
  graphCallbacks.register('beforeNode', async ({ node }) => {
    const step = stepsByNodeId.get(node.id);
    if (!step) {
      return;
    }
    await updateStepStatus(store, mission, userId, step.id, 'running');
    await callbacks?.onStepStarted?.(step.id);
  });
  graphCallbacks.register('afterNode', async ({ node, result }) => {
    const step = stepsByNodeId.get(node.id);
    if (!step) {
      return;
    }
    await updateStepStatus(store, mission, userId, step.id, 'done');
    await callbacks?.onStepCompleted?.(step.id, result);
    if (typeof result === 'string' && result.length > 0 && shouldPromoteMissionResult(step)) {
      void embedAndStore(store, null, {
        userId,
        content: `Mission step [${step.title}]: ${result}`,
        segmentType: 'mission_step_result',
        taskId: mission.id,
        confidence: 0.7,
      }).catch(() => undefined);
    }
  });
  graphCallbacks.register('onBlocked', async ({ node }) => {
    const step = stepsByNodeId.get(node.id);
    if (!step) {
      return;
    }
    await updateStepStatus(store, mission, userId, step.id, 'blocked');
  });
  graphCallbacks.register('onFail', async ({ node, error }) => {
    if (!node) {
      return;
    }
    const step = stepsByNodeId.get(node.id);
    if (!step) {
      return;
    }
    await updateStepStatus(store, mission, userId, step.id, 'failed');
    await callbacks?.onStepFailed?.(step.id, error.message);
  });

  try {
    const result = await executeExecutionGraph(graph, {
      callbacks: graphCallbacks,
      maxConcurrency: 4,
      failFast: false,
      defaultExecutor: async ({ node, graphRun, state, dependencyResults }) => {
        const step = stepsByNodeId.get(node.id);
        if (!step) {
          throw new Error(`mission_step_missing:${node.id}`);
        }
        const pattern = resolveStepPattern(step);
        if (pattern === 'human_gate') {
          throw new GraphExecutionHalt({
            message: 'approval_required',
            nodeStatus: 'blocked',
            graphStatus: 'blocked'
          });
        }
        if (pattern === 'tool_call') {
          const invocation = buildMissionToolInvocation(step);
          const policy = evaluateToolInvocationPolicy(invocation);
          if (policy.disposition !== 'allow') {
            throw new GraphExecutionHalt({
              message: policy.rationale,
              nodeStatus: 'blocked',
              graphStatus: 'blocked'
            });
          }
          await graphCallbacks.emit('beforeTool', {
            graph,
            graphRun,
            node,
            state,
            invocation
          });
          const toolResult = await executeStep(
            step,
            dependencyResults,
            store,
            env,
            providerRouter,
            mission.id,
            userId,
            options?.modelSelectionOverride,
            options?.resolvedModelSelection,
            credentialsByProvider
          );
          await graphCallbacks.emit('afterTool', {
            graph,
            graphRun,
            node,
            state,
            invocation,
            result: toolResult
          });
          return toolResult;
        }
        return executeStep(
          step,
          dependencyResults,
          store,
          env,
          providerRouter,
          mission.id,
          userId,
          options?.modelSelectionOverride,
          options?.resolvedModelSelection,
          credentialsByProvider
        );
      }
    });

    await store.updateMission({
      missionId: mission.id,
      userId,
      status: result.halted ? 'blocked' : 'completed'
    });

    return {
      success: !result.halted,
      results: result.results,
      completedOrder: result.completedOrder,
      graphRun: result.graphRun
    };
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
