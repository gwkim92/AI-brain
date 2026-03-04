import { randomUUID } from 'node:crypto';

import type { V2RiskLevel } from '../store/types';
import { evaluateCodeLoopPolicy } from './policy';
import type { CodeLoopEventV2, CodeLoopRunV2, CodeLoopStatusV2, CodeLoopStepNameV2, CodeLoopStepRecordV2 } from './types';

type StartCodeLoopInput = {
  userId: string;
  contractId: string;
  prompt: string;
  riskLevel: V2RiskLevel;
  changedFiles: string[];
  policyViolations?: string[];
  simulate?: {
    test_failures?: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

export class CodeLoopEngineV2 {
  private readonly runs = new Map<string, CodeLoopRunV2>();

  getRun(runId: string): CodeLoopRunV2 | null {
    return this.runs.get(runId) ?? null;
  }

  private pushEvent(run: CodeLoopRunV2, type: string, data: Record<string, unknown>) {
    const event: CodeLoopEventV2 = {
      id: randomUUID(),
      type,
      timestamp: nowIso(),
      data
    };
    run.events.push(event);
    run.updatedAt = event.timestamp;
  }

  private appendStep(
    run: CodeLoopRunV2,
    step: CodeLoopStepNameV2,
    status: CodeLoopStepRecordV2['status'],
    log: string,
    metadata: Record<string, unknown> = {}
  ) {
    const startedAt = nowIso();
    const completedAt = nowIso();
    const record: CodeLoopStepRecordV2 = {
      id: randomUUID(),
      step,
      status,
      startedAt,
      completedAt,
      log,
      metadata
    };
    run.steps.push(record);
    this.pushEvent(run, `code_loop.step.${status}`, {
      run_id: run.id,
      step,
      log
    });
  }

  private setStatus(run: CodeLoopRunV2, status: CodeLoopStatusV2) {
    run.status = status;
    run.updatedAt = nowIso();
  }

  private runPipeline(run: CodeLoopRunV2, testFailures: number) {
    this.appendStep(run, 'plan', 'completed', 'Execution plan generated');
    this.setStatus(run, 'planned');

    this.appendStep(run, 'patch', 'completed', 'Patch produced');
    this.setStatus(run, 'patched');

    let remainingTestFailures = testFailures;
    while (true) {
      if (remainingTestFailures > 0) {
        this.appendStep(run, 'test', 'failed', 'Test suite failed', {
          remaining_failures: remainingTestFailures
        });
        remainingTestFailures -= 1;

        if (run.retryCount < 1) {
          run.retryCount += 1;
          this.pushEvent(run, 'code_loop.auto_repair.started', {
            run_id: run.id,
            retry_count: run.retryCount
          });
          this.appendStep(run, 'patch', 'completed', 'Auto-repair patch produced', {
            auto_repair: true
          });
          this.setStatus(run, 'patched');
          continue;
        }

        run.blockedReasons = Array.from(new Set([...run.blockedReasons, 'test_failed_after_auto_repair']));
        this.setStatus(run, 'blocked');
        this.pushEvent(run, 'code_loop.run.blocked', {
          run_id: run.id,
          reasons: run.blockedReasons
        });
        return;
      }

      this.appendStep(run, 'test', 'completed', 'Test suite passed');
      this.setStatus(run, 'tested');
      break;
    }

    this.appendStep(run, 'lint', 'completed', 'Lint passed');
    this.setStatus(run, 'linted');

    this.appendStep(run, 'review', 'completed', 'Review completed');
    this.setStatus(run, 'reviewed');

    if (run.requiresApproval && !run.approvedAt) {
      run.blockedReasons = Array.from(new Set([...run.blockedReasons, 'approval_required']));
      this.setStatus(run, 'blocked');
      this.pushEvent(run, 'code_loop.run.awaiting_approval', {
        run_id: run.id,
        reasons: run.blockedReasons
      });
      return;
    }

    this.appendStep(run, 'pr_open', 'completed', 'PR opened');
    this.setStatus(run, 'pr_opened');
    this.setStatus(run, 'completed');
    this.pushEvent(run, 'code_loop.run.completed', {
      run_id: run.id
    });
  }

  async startRun(input: StartCodeLoopInput): Promise<CodeLoopRunV2> {
    const policy = evaluateCodeLoopPolicy({
      riskLevel: input.riskLevel,
      changedFiles: input.changedFiles,
      policyViolations: input.policyViolations
    });
    const now = nowIso();
    const run: CodeLoopRunV2 = {
      id: randomUUID(),
      userId: input.userId,
      contractId: input.contractId,
      prompt: input.prompt,
      status: 'planned',
      retryCount: 0,
      blockedReasons: [...policy.reasons],
      requiresApproval: policy.requiresApproval,
      approvedAt: null,
      changedFiles: [...input.changedFiles],
      steps: [],
      events: [],
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(run.id, run);
    this.pushEvent(run, 'code_loop.run.started', {
      run_id: run.id,
      requires_approval: run.requiresApproval
    });

    this.runPipeline(run, input.simulate?.test_failures ?? 0);
    return run;
  }

  async approveRun(input: { runId: string; userId: string }): Promise<CodeLoopRunV2 | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.userId !== input.userId) return null;
    if (!run.requiresApproval) return run;
    if (run.status !== 'blocked') return run;
    if (!run.blockedReasons.includes('approval_required')) return run;

    run.approvedAt = nowIso();
    run.blockedReasons = run.blockedReasons.filter((reason) => reason !== 'approval_required');
    this.pushEvent(run, 'code_loop.run.approved', {
      run_id: run.id
    });

    this.appendStep(run, 'pr_open', 'completed', 'PR opened after approval');
    this.setStatus(run, 'pr_opened');
    this.setStatus(run, 'completed');
    this.pushEvent(run, 'code_loop.run.completed', {
      run_id: run.id,
      resumed_from_approval: true
    });
    return run;
  }

  async replanRun(input: { runId: string; userId: string }): Promise<CodeLoopRunV2 | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.userId !== input.userId) return null;
    if (run.status !== 'blocked' && run.status !== 'failed') return run;

    run.steps = [];
    run.events = [];
    run.retryCount = 0;
    run.blockedReasons = run.blockedReasons.filter((reason) => reason !== 'test_failed_after_auto_repair');
    run.approvedAt = null;
    run.updatedAt = nowIso();
    this.pushEvent(run, 'code_loop.run.replanned', {
      run_id: run.id
    });

    this.runPipeline(run, 0);
    return run;
  }
}

let sharedCodeLoopEngine: CodeLoopEngineV2 | null = null;

export function getSharedCodeLoopEngine(): CodeLoopEngineV2 {
  if (!sharedCodeLoopEngine) {
    sharedCodeLoopEngine = new CodeLoopEngineV2();
  }
  return sharedCodeLoopEngine;
}
