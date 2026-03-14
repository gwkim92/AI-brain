import { randomUUID } from 'node:crypto';

import { runWithChaosInjection, type ChaosScenario } from '../../chaos/injectors';
import { getSharedLineageRecorder } from '../../lineage/recorder';
import guardrailsDataset from './datasets/guardrails.json';
import smokeDataset from './datasets/smoke.json';

export type EvalCaseRecord = {
  id: string;
  input: string;
  expected_domain: string;
};

export type EvalCaseResult = {
  id: string;
  passed: boolean;
  predicted_domain: string;
  expected_domain: string;
  error?: string;
};

export type EvalRunRecord = {
  id: string;
  suite: string;
  status: 'completed' | 'failed';
  passRate: number;
  threshold: number;
  caseResults: EvalCaseResult[];
  createdAt: string;
  updatedAt: string;
};

const DATASET_BY_SUITE: Record<string, EvalCaseRecord[]> = {
  smoke: smokeDataset as EvalCaseRecord[],
  guardrails: guardrailsDataset as EvalCaseRecord[]
};

function classifyDomain(input: string): string {
  if (/(code|patch|debug|test|deploy|리팩토링|버그)/iu.test(input)) return 'code';
  if (/(portfolio|market|finance|stock|rate|risk|금리|포트폴리오)/iu.test(input)) return 'finance';
  if (/(research|evidence|citation|summarize|요약|근거)/iu.test(input)) return 'research';
  return 'general';
}

export class EvalRunnerV2 {
  private readonly runs = new Map<string, EvalRunRecord>();
  private readonly lineage = getSharedLineageRecorder();

  getRun(runId: string): EvalRunRecord | null {
    return this.runs.get(runId) ?? null;
  }

  async runSuite(input: {
    suite: string;
    threshold?: number;
    chaosScenario?: ChaosScenario;
  }): Promise<EvalRunRecord> {
    const dataset = DATASET_BY_SUITE[input.suite];
    if (!dataset) {
      throw new Error(`unknown_eval_suite:${input.suite}`);
    }

    const threshold = input.threshold ?? 0.7;
    const runId = randomUUID();
    const runNode = this.lineage.recordNode({
      runId,
      nodeType: 'eval_run',
      referenceId: runId,
      metadata: { suite: input.suite }
    });

    const caseResults: EvalCaseResult[] = [];
    for (let index = 0; index < dataset.length; index += 1) {
      const evalCase = dataset[index]!;
      const caseNode = this.lineage.recordNode({
        runId,
        nodeType: 'eval_case',
        referenceId: evalCase.id
      });
      this.lineage.recordEdge({
        runId,
        sourceNodeId: runNode.id,
        targetNodeId: caseNode.id,
        edgeType: 'contains'
      });

      try {
        const predicted = await runWithChaosInjection({
          scenario: input.chaosScenario ?? 'none',
          target: 'model',
          seed: index + 1,
          failureRate: 1,
          task: () => classifyDomain(evalCase.input)
        });
        caseResults.push({
          id: evalCase.id,
          passed: predicted === evalCase.expected_domain,
          predicted_domain: predicted,
          expected_domain: evalCase.expected_domain
        });
      } catch (error) {
        caseResults.push({
          id: evalCase.id,
          passed: false,
          predicted_domain: 'error',
          expected_domain: evalCase.expected_domain,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const passedCount = caseResults.filter((item) => item.passed).length;
    const passRate = dataset.length > 0 ? passedCount / dataset.length : 0;
    const status: EvalRunRecord['status'] = passRate >= threshold ? 'completed' : 'failed';
    const now = new Date().toISOString();
    const record: EvalRunRecord = {
      id: runId,
      suite: input.suite,
      status,
      passRate: Number(passRate.toFixed(4)),
      threshold,
      caseResults,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(runId, record);
    return record;
  }
}

let sharedEvalRunner: EvalRunnerV2 | null = null;

export function getSharedEvalRunner(): EvalRunnerV2 {
  if (!sharedEvalRunner) {
    sharedEvalRunner = new EvalRunnerV2();
  }
  return sharedEvalRunner;
}
