import { Pool } from 'pg';

import { createAssistantContextRepository } from './postgres/assistant-context-repository';
import { createAuthRepository } from './postgres/auth-repository';
import { createCouncilExecutionApprovalRepository } from './postgres/council-execution-approval-repository';
import { createExternalWorkRepository } from './postgres/external-work-repository';
import { initializePostgresStore } from './postgres/initializer';
import { createJarvisRepository } from './postgres/jarvis-repository';
import { createPostgresIntelligenceRepository } from './postgres/intelligence-repository';
import { createMemoryRepository } from './postgres/memory-repository';
import { createMissionRepository } from './postgres/mission-repository';
import { createRadarUpgradeRepository } from './postgres/radar-upgrade-repository';
import { createRunnerRepository } from './postgres/runner-repository';
import { createTaskRepository } from './postgres/task-repository';
import { createTelegramReportRepository } from './postgres/telegram-report-repository';
import { createPostgresUpgradeExecutorGateway } from './postgres/upgrade-executor-gateway';
import { createPostgresWorldModelRepository } from './postgres/world-model-repository';
import { assertStoreContractInDev } from './contract-assertions';
import type { PostgresStoreOptions } from './postgres/types';
import type { JarvisStore } from './types';

export function createPostgresStore(options: PostgresStoreOptions): JarvisStore {
  const pool = new Pool({ connectionString: options.connectionString });

  const store: JarvisStore = {
    kind: 'postgres',

    getPool() {
      return pool;
    },

    async initialize() {
      await initializePostgresStore({
        pool,
        defaultUserId: options.defaultUserId,
        defaultUserEmail: options.defaultUserEmail
      });
    },

    async health() {
      try {
        await pool.query('SELECT 1');
        return {
          store: 'postgres',
          db: 'up'
        };
      } catch {
        return {
          store: 'postgres',
          db: 'down'
        };
      }
    },

    ...createAuthRepository({
      pool
    }),

    ...createJarvisRepository({
      pool
    }),

    ...createMissionRepository({
      pool,
      defaultUserId: options.defaultUserId
    }),

    ...createAssistantContextRepository({
      pool,
      defaultUserId: options.defaultUserId
    }),

    ...createTaskRepository({
      pool,
      defaultUserId: options.defaultUserId
    }),

    ...createExternalWorkRepository({
      pool
    }),

    ...createRunnerRepository({
      pool
    }),

    ...createRadarUpgradeRepository({
      pool,
      defaultUserId: options.defaultUserId
    }),

    ...createTelegramReportRepository({
      pool
    }),

    ...createCouncilExecutionApprovalRepository({
      pool
    }),

    ...createMemoryRepository({
      pool
    }),

    ...createPostgresIntelligenceRepository({
      pool
    }),

    ...createPostgresWorldModelRepository({
      pool
    }),

    createUpgradeExecutorGateway() {
      return createPostgresUpgradeExecutorGateway({
        pool,
        defaultUserId: options.defaultUserId,
        store
      });
    }
  };

  assertStoreContractInDev(store, 'postgres');
  return store;
}
