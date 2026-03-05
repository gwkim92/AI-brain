import { setTimeout as sleep } from 'node:timers/promises';

export type SupervisedWorkerStatus<TRun> = {
  enabled: boolean;
  inflight: boolean;
  lastRun: TRun | null;
  history: TRun[];
};

export type SupervisedWorkerHandle<TRun> = {
  stop: () => void;
  status: () => SupervisedWorkerStatus<TRun>;
};

type StartWorkerSupervisorInput<TRun> = {
  enabled: boolean;
  pollMs: number;
  timeoutMs: number;
  historyLimit: number;
  runOnce: (startedAt: Date) => Promise<TRun>;
  onRunError: (input: {
    startedAt: Date;
    finishedAt: Date;
    status: 'error' | 'timeout';
    error: unknown;
  }) => TRun;
  onAfterRun?: (run: TRun) => void;
  onStatusChange?: (status: SupervisedWorkerStatus<TRun>) => void;
};

class WorkerTimeoutError extends Error {
  constructor(message = 'worker run timeout') {
    super(message);
    this.name = 'WorkerTimeoutError';
  }
}

function cloneStatus<TRun>(status: SupervisedWorkerStatus<TRun>): SupervisedWorkerStatus<TRun> {
  return {
    enabled: status.enabled,
    inflight: status.inflight,
    lastRun: status.lastRun,
    history: [...status.history]
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => {
      throw new WorkerTimeoutError();
    })
  ]);
}

export function startWorkerSupervisor<TRun>(input: StartWorkerSupervisorInput<TRun>): SupervisedWorkerHandle<TRun> {
  const runtime: SupervisedWorkerStatus<TRun> = {
    enabled: input.enabled,
    inflight: false,
    lastRun: null,
    history: []
  };
  input.onStatusChange?.(cloneStatus(runtime));

  if (!input.enabled) {
    return {
      stop: () => undefined,
      status: () => cloneStatus(runtime)
    };
  }

  let closed = false;
  const pollMs = Math.max(1000, Math.trunc(input.pollMs));
  const timeoutMs = Math.max(1000, Math.trunc(input.timeoutMs));
  const historyLimit = Math.max(1, Math.trunc(input.historyLimit));

  const tick = async () => {
    if (closed || runtime.inflight) {
      return;
    }

    runtime.inflight = true;
    input.onStatusChange?.(cloneStatus(runtime));

    const startedAt = new Date();
    let run: TRun;
    try {
      run = await withTimeout(input.runOnce(startedAt), timeoutMs);
    } catch (error) {
      const finishedAt = new Date();
      const timeout = error instanceof WorkerTimeoutError;
      run = input.onRunError({
        startedAt,
        finishedAt,
        status: timeout ? 'timeout' : 'error',
        error
      });
    }

    runtime.lastRun = run;
    runtime.history = [run, ...runtime.history].slice(0, historyLimit);
    runtime.inflight = false;
    input.onAfterRun?.(run);
    input.onStatusChange?.(cloneStatus(runtime));
  };

  const timer = setInterval(() => {
    void tick();
  }, pollMs);
  void tick();

  return {
    stop: () => {
      closed = true;
      clearInterval(timer);
      runtime.enabled = false;
      runtime.inflight = false;
      input.onStatusChange?.(cloneStatus(runtime));
    },
    status: () => cloneStatus(runtime)
  };
}

