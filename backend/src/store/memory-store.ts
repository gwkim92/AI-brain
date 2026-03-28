import { createMemoryAssistantContextRepository } from './memory/assistant-context-repository';
import { createMemoryAuthRepository } from './memory/auth-repository';
import { createMemoryCouncilExecutionApprovalRepository } from './memory/council-execution-approval-repository';
import { createMemoryExternalWorkRepository } from './memory/external-work-repository';
import { initializeMemoryStore } from './memory/initializer';
import { createMemoryJarvisRepository } from './memory/jarvis-repository';
import { createMemoryIntelligenceRepository } from './memory/intelligence-repository';
import { createMemoryMemoryRepository } from './memory/memory-repository';
import { createMemoryMissionRepository } from './memory/mission-repository';
import { createMemoryRadarUpgradeRepository } from './memory/radar-upgrade-repository';
import { createMemoryRunnerRepository } from './memory/runner-repository';
import { createMemoryStoreState, nowIso } from './memory/state';
import { createMemoryTaskRepository } from './memory/task-repository';
import { createMemoryTelegramReportRepository } from './memory/telegram-report-repository';
import { createMemoryUpgradeExecutorGateway } from './memory/upgrade-executor-gateway';
import { createMemoryWorldModelRepository } from './memory/world-model-repository';
import { assertStoreContractInDev } from './contract-assertions';
import type { JarvisStore } from './types';

export function createMemoryStore(defaultUserId: string, defaultUserEmail = 'jarvis-local@example.com'): JarvisStore {
  const state = createMemoryStoreState();

  const store: JarvisStore = {
    kind: 'memory',

    getPool() {
      return null;
    },

    async initialize() {
      await initializeMemoryStore({
        state,
        defaultUserId,
        defaultUserEmail,
        nowIso
      });
    },

    async health() {
      return {
        store: 'memory',
        db: 'n/a'
      };
    },

    ...createMemoryAuthRepository({
      state,
      nowIso
    }),

    ...createMemoryJarvisRepository({
      state,
      nowIso
    }),

    ...createMemoryMissionRepository({
      state,
      defaultUserId,
      nowIso
    }),

    ...createMemoryAssistantContextRepository({
      state,
      defaultUserId,
      nowIso
    }),

    ...createMemoryTaskRepository({
      state,
      defaultUserId,
      nowIso
    }),

    ...createMemoryExternalWorkRepository({
      state,
      nowIso
    }),

    ...createMemoryRunnerRepository({
      state,
      nowIso
    }),

    ...createMemoryRadarUpgradeRepository({
      state,
      nowIso
    }),

    ...createMemoryTelegramReportRepository({
      state,
      nowIso
    }),

    ...createMemoryCouncilExecutionApprovalRepository({
      state,
      nowIso
    }),

    ...createMemoryMemoryRepository({
      state
    }),

    ...createMemoryIntelligenceRepository({
      state,
      nowIso
    }),

    ...createMemoryWorldModelRepository({
      state,
      nowIso
    }),

    createUpgradeExecutorGateway() {
      return createMemoryUpgradeExecutorGateway(store);
    }
  };

  assertStoreContractInDev(store, 'memory');
  return store;
}
