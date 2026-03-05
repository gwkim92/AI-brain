import { randomUUID } from 'node:crypto';

import type {
  AiInvocationMetrics,
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
  ModelControlFeatureKey,
  ProviderCredentialProvider,
  UserRole
} from '../types';
import type { AuthRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryAuthRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

function toAuthUserRecord(row: AuthUserWithPasswordRecord): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function userProviderCredentialKey(userId: string, provider: ProviderCredentialProvider): string {
  return `${userId}:${provider}`;
}

function modelSelectionPreferenceKey(userId: string, featureKey: ModelControlFeatureKey): string {
  return `${userId}:${featureKey}`;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(1000, Math.max(1, Math.trunc(limit)));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

export function createMemoryAuthRepository({ state, nowIso }: MemoryAuthRepositoryDeps): AuthRepositoryContract {
  return {
    async createAuthUser(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role?: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      if (state.userIdByEmail.has(email)) {
        return null;
      }

      const now = nowIso();
      const user: AuthUserWithPasswordRecord = {
        id: randomUUID(),
        email,
        displayName: input.displayName?.trim() || null,
        role: input.role ?? 'member',
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now
      };
      state.users.set(user.id, user);
      state.userIdByEmail.set(email, user.id);
      return toAuthUserRecord(user);
    },

    async upsertAuthUserByEmail(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      const existingUserId = state.userIdByEmail.get(email);
      const now = nowIso();

      if (existingUserId) {
        const existing = state.users.get(existingUserId);
        if (!existing) {
          throw new Error('inconsistent user index state');
        }

        const next: AuthUserWithPasswordRecord = {
          ...existing,
          displayName: input.displayName?.trim() || existing.displayName,
          role: input.role,
          passwordHash: input.passwordHash,
          updatedAt: now
        };
        state.users.set(existingUserId, next);
        return toAuthUserRecord(next);
      }

      const created: AuthUserWithPasswordRecord = {
        id: randomUUID(),
        email,
        displayName: input.displayName?.trim() || null,
        role: input.role,
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now
      };
      state.users.set(created.id, created);
      state.userIdByEmail.set(email, created.id);
      return toAuthUserRecord(created);
    },

    async findAuthUserByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      const userId = state.userIdByEmail.get(normalized);
      if (!userId) {
        return null;
      }

      const user = state.users.get(userId);
      return user ?? null;
    },

    async getAuthUserById(userId: string) {
      const user = state.users.get(userId);
      if (!user) {
        return null;
      }
      return toAuthUserRecord(user);
    },

    async createAuthSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
      state.sessions.set(input.tokenHash, {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null
      });
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
      const session = state.sessions.get(tokenHash);
      if (!session || session.revokedAt !== null) {
        return null;
      }

      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        state.sessions.delete(tokenHash);
        return null;
      }

      const user = state.users.get(session.userId);
      if (!user) {
        state.sessions.delete(tokenHash);
        return null;
      }

      return {
        user: toAuthUserRecord(user),
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt
      };
    },

    async revokeAuthSession(tokenHash: string) {
      const session = state.sessions.get(tokenHash);
      if (!session) {
        return false;
      }

      if (session.revokedAt !== null) {
        return false;
      }

      state.sessions.set(tokenHash, {
        ...session,
        revokedAt: nowIso()
      });
      return true;
    },

    async listProviderCredentials() {
      return [...state.providerCredentials.entries()].map(([provider, row]) => ({
        provider: provider as ProviderCredentialProvider,
        encryptedApiKey: row.encryptedApiKey,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt
      }));
    },

    async upsertProviderCredential(input: {
      provider: ProviderCredentialProvider;
      encryptedApiKey: string;
      updatedBy?: string | null;
    }) {
      const next = {
        encryptedApiKey: input.encryptedApiKey,
        updatedBy: input.updatedBy ?? null,
        updatedAt: nowIso()
      };
      state.providerCredentials.set(input.provider, next);
      return {
        provider: input.provider,
        encryptedApiKey: next.encryptedApiKey,
        updatedBy: next.updatedBy,
        updatedAt: next.updatedAt
      };
    },

    async deleteProviderCredential(provider: ProviderCredentialProvider) {
      return state.providerCredentials.delete(provider);
    },

    async listUserProviderCredentials(input: { userId: string; includeInactive?: boolean }) {
      const includeInactive = input.includeInactive === true;
      const rows: Array<{
        userId: string;
        provider: ProviderCredentialProvider;
        encryptedPayload: string;
        isActive: boolean;
        updatedBy: string | null;
        updatedAt: string;
      }> = [];

      for (const [key, row] of state.userProviderCredentials.entries()) {
        const [userId, provider] = key.split(':');
        if (userId !== input.userId) {
          continue;
        }
        if (!includeInactive && !row.isActive) {
          continue;
        }
        rows.push({
          userId,
          provider: provider as ProviderCredentialProvider,
          encryptedPayload: row.encryptedPayload,
          isActive: row.isActive,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt
        });
      }

      rows.sort((left, right) => left.provider.localeCompare(right.provider));
      return rows;
    },

    async getUserProviderCredential(input: {
      userId: string;
      provider: ProviderCredentialProvider;
      includeInactive?: boolean;
    }) {
      const key = userProviderCredentialKey(input.userId, input.provider);
      const row = state.userProviderCredentials.get(key);
      if (!row) {
        return null;
      }
      if (!input.includeInactive && !row.isActive) {
        return null;
      }
      return {
        userId: input.userId,
        provider: input.provider,
        encryptedPayload: row.encryptedPayload,
        isActive: row.isActive,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt
      };
    },

    async upsertUserProviderCredential(input: {
      userId: string;
      provider: ProviderCredentialProvider;
      encryptedPayload: string;
      isActive?: boolean;
      updatedBy?: string | null;
    }) {
      const key = userProviderCredentialKey(input.userId, input.provider);
      const next = {
        encryptedPayload: input.encryptedPayload,
        isActive: input.isActive ?? true,
        updatedBy: input.updatedBy ?? null,
        updatedAt: nowIso()
      };
      state.userProviderCredentials.set(key, next);
      return {
        userId: input.userId,
        provider: input.provider,
        encryptedPayload: next.encryptedPayload,
        isActive: next.isActive,
        updatedBy: next.updatedBy,
        updatedAt: next.updatedAt
      };
    },

    async deleteUserProviderCredential(input: { userId: string; provider: ProviderCredentialProvider }) {
      return state.userProviderCredentials.delete(userProviderCredentialKey(input.userId, input.provider));
    },

    async listActiveUserProviderCredentials(input: { provider?: ProviderCredentialProvider; limit: number }) {
      const limit = normalizeLimit(input.limit);
      const rows: Array<{
        userId: string;
        provider: ProviderCredentialProvider;
        encryptedPayload: string;
        isActive: boolean;
        updatedBy: string | null;
        updatedAt: string;
      }> = [];

      for (const [key, row] of state.userProviderCredentials.entries()) {
        if (!row.isActive) {
          continue;
        }
        const [userId, provider] = key.split(':');
        if (input.provider && provider !== input.provider) {
          continue;
        }
        rows.push({
          userId,
          provider: provider as ProviderCredentialProvider,
          encryptedPayload: row.encryptedPayload,
          isActive: row.isActive,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt
        });
      }

      rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return rows.slice(0, limit);
    },

    async createProviderOauthState(input: {
      state: string;
      userId: string;
      provider: ProviderCredentialProvider;
      encryptedContext: string;
      expiresAt: string;
    }) {
      const row = {
        state: input.state,
        userId: input.userId,
        provider: input.provider,
        encryptedContext: input.encryptedContext,
        expiresAt: input.expiresAt,
        consumedAt: null,
        createdAt: nowIso()
      };
      state.providerOauthStates.set(input.state, row);
      return row;
    },

    async consumeProviderOauthState(input: { state: string; provider: ProviderCredentialProvider }) {
      const row = state.providerOauthStates.get(input.state);
      if (!row) {
        return null;
      }
      if (row.provider !== input.provider) {
        return null;
      }
      if (row.consumedAt !== null) {
        return null;
      }
      const now = nowIso();
      if (Date.parse(row.expiresAt) <= Date.parse(now)) {
        return null;
      }

      const consumed = {
        ...row,
        consumedAt: now
      };
      state.providerOauthStates.set(input.state, consumed);
      return consumed;
    },

    async cleanupExpiredProviderOauthStates(input?: { nowIso?: string; limit?: number }) {
      const now = input?.nowIso ?? nowIso();
      const limit = normalizeLimit(input?.limit ?? 200);
      let removed = 0;

      for (const [stateKey, row] of state.providerOauthStates.entries()) {
        if (removed >= limit) {
          break;
        }
        if (row.consumedAt !== null || Date.parse(row.expiresAt) <= Date.parse(now)) {
          state.providerOauthStates.delete(stateKey);
          removed += 1;
        }
      }

      return removed;
    },

    async listUserModelSelectionPreferences(input: { userId: string }) {
      const rows = [...state.userModelSelectionPreferences.values()]
        .filter((row) => row.userId === input.userId)
        .sort((left, right) => left.featureKey.localeCompare(right.featureKey));
      return rows;
    },

    async getUserModelSelectionPreference(input: {
      userId: string;
      featureKey: ModelControlFeatureKey;
    }) {
      return state.userModelSelectionPreferences.get(modelSelectionPreferenceKey(input.userId, input.featureKey)) ?? null;
    },

    async upsertUserModelSelectionPreference(input) {
      const key = modelSelectionPreferenceKey(input.userId, input.featureKey);
      const next = {
        userId: input.userId,
        featureKey: input.featureKey,
        provider: input.provider,
        modelId: input.modelId ?? null,
        strictProvider: input.strictProvider ?? false,
        selectionMode: input.selectionMode ?? 'manual',
        updatedBy: input.updatedBy ?? null,
        updatedAt: nowIso()
      };
      state.userModelSelectionPreferences.set(key, next);
      return next;
    },

    async deleteUserModelSelectionPreference(input: { userId: string; featureKey: ModelControlFeatureKey }) {
      return state.userModelSelectionPreferences.delete(modelSelectionPreferenceKey(input.userId, input.featureKey));
    },

    async createModelRecommendationRun(input) {
      const createdAt = nowIso();
      const row = {
        id: randomUUID(),
        userId: input.userId,
        featureKey: input.featureKey,
        promptHash: input.promptHash,
        promptExcerptRedacted: input.promptExcerptRedacted,
        recommendedProvider: input.recommendedProvider,
        recommendedModelId: input.recommendedModelId,
        rationaleText: input.rationaleText,
        evidenceJson: input.evidenceJson ?? {},
        recommenderProvider: input.recommenderProvider ?? 'openai',
        appliedAt: null,
        createdAt
      };
      state.modelRecommendationRuns.set(row.id, row);
      return row;
    },

    async listModelRecommendationRuns(input: { userId: string; limit: number; featureKey?: ModelControlFeatureKey }) {
      const limit = normalizeLimit(input.limit);
      return [...state.modelRecommendationRuns.values()]
        .filter((row) => row.userId === input.userId && (!input.featureKey || row.featureKey === input.featureKey))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },

    async markModelRecommendationApplied(input: { recommendationId: string; userId: string }) {
      const current = state.modelRecommendationRuns.get(input.recommendationId);
      if (!current || current.userId !== input.userId) {
        return null;
      }
      const next = {
        ...current,
        appliedAt: current.appliedAt ?? nowIso()
      };
      state.modelRecommendationRuns.set(next.id, next);
      return next;
    },

    async cleanupExpiredModelRecommendationRuns(input?: { nowIso?: string; retentionDays?: number; limit?: number }) {
      const now = Date.parse(input?.nowIso ?? nowIso());
      const retentionDays = Math.max(1, Math.min(365, Math.trunc(input?.retentionDays ?? 30)));
      const limit = normalizeLimit(input?.limit ?? 500);
      let removed = 0;
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

      const rows = [...state.modelRecommendationRuns.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const row of rows) {
        if (removed >= limit) {
          break;
        }
        const createdAtMs = Date.parse(row.createdAt);
        if (!Number.isFinite(createdAtMs)) {
          continue;
        }
        if (createdAtMs <= now - retentionMs) {
          state.modelRecommendationRuns.delete(row.id);
          removed += 1;
        }
      }
      return removed;
    },

    async createAiInvocationTrace(input) {
      const row = {
        id: randomUUID(),
        userId: input.userId,
        featureKey: input.featureKey,
        taskType: input.taskType,
        requestProvider: input.requestProvider,
        requestModel: input.requestModel ?? null,
        resolvedProvider: null,
        resolvedModel: null,
        credentialMode: null,
        credentialSource: 'none' as const,
        attemptsJson: [],
        usedFallback: false,
        success: false,
        errorCode: null,
        errorMessageRedacted: null,
        latencyMs: 0,
        traceId: input.traceId ?? null,
        contextRefsJson: input.contextRefsJson ?? {},
        createdAt: nowIso()
      };
      state.aiInvocationTraces.set(row.id, row);
      return row;
    },

    async completeAiInvocationTrace(input) {
      const current = state.aiInvocationTraces.get(input.id);
      if (!current) {
        return null;
      }
      const next = {
        ...current,
        resolvedProvider:
          typeof input.resolvedProvider === 'undefined'
            ? current.resolvedProvider
            : input.resolvedProvider,
        resolvedModel:
          typeof input.resolvedModel === 'undefined'
            ? current.resolvedModel
            : input.resolvedModel,
        credentialMode:
          typeof input.credentialMode === 'undefined'
            ? current.credentialMode
            : input.credentialMode,
        credentialSource:
          typeof input.credentialSource === 'undefined'
            ? current.credentialSource
            : input.credentialSource,
        attemptsJson:
          typeof input.attemptsJson === 'undefined'
            ? current.attemptsJson
            : input.attemptsJson,
        usedFallback:
          typeof input.usedFallback === 'undefined'
            ? current.usedFallback
            : input.usedFallback,
        success: input.success,
        errorCode: input.errorCode ?? null,
        errorMessageRedacted: input.errorMessageRedacted ?? null,
        latencyMs: Math.max(0, Math.trunc(input.latencyMs))
      };
      state.aiInvocationTraces.set(next.id, next);
      return next;
    },

    async listAiInvocationTraces(input) {
      const limit = normalizeLimit(input.limit);
      return [...state.aiInvocationTraces.values()]
        .filter((row) => {
          if (row.userId !== input.userId) return false;
          if (input.featureKey && row.featureKey !== input.featureKey) return false;
          if (typeof input.success === 'boolean' && row.success !== input.success) return false;
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },

    async getAiInvocationMetrics(input): Promise<AiInvocationMetrics> {
      const sinceIso = input.sinceIso ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sinceMs = Date.parse(sinceIso);
      const rows = [...state.aiInvocationTraces.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => {
          const createdAtMs = Date.parse(row.createdAt);
          if (!Number.isFinite(createdAtMs) || !Number.isFinite(sinceMs)) {
            return true;
          }
          return createdAtMs >= sinceMs;
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

      const total = rows.length;
      const successCount = rows.filter((row) => row.success).length;
      const failureCount = total - successCount;
      const latencies = rows.map((row) => Math.max(0, row.latencyMs));
      const providerCounter = new Map<'openai' | 'gemini' | 'anthropic' | 'local', number>();
      const sourceCounter = new Map<'user' | 'workspace' | 'env' | 'none', number>();
      for (const row of rows) {
        if (row.resolvedProvider) {
          providerCounter.set(row.resolvedProvider, (providerCounter.get(row.resolvedProvider) ?? 0) + 1);
        }
        sourceCounter.set(row.credentialSource, (sourceCounter.get(row.credentialSource) ?? 0) + 1);
      }

      return {
        windowStart: sinceIso,
        windowEnd: rows[rows.length - 1]?.createdAt ?? nowIso(),
        total,
        successCount,
        failureCount,
        successRate: total > 0 ? Number((successCount / total).toFixed(4)) : 0,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        providerDistribution: Array.from(providerCounter.entries())
          .map(([provider, count]) => ({ provider, count }))
          .sort((left, right) => right.count - left.count),
        credentialSourceDistribution: Array.from(sourceCounter.entries())
          .map(([source, count]) => ({ source, count }))
          .sort((left, right) => right.count - left.count)
      };
    },

    async cleanupExpiredAiInvocationTraces(input?: { nowIso?: string; retentionDays?: number; limit?: number }) {
      const now = Date.parse(input?.nowIso ?? nowIso());
      const retentionDays = Math.max(1, Math.min(365, Math.trunc(input?.retentionDays ?? 30)));
      const limit = normalizeLimit(input?.limit ?? 1000);
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      let removed = 0;
      const rows = [...state.aiInvocationTraces.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const row of rows) {
        if (removed >= limit) {
          break;
        }
        const createdAtMs = Date.parse(row.createdAt);
        if (!Number.isFinite(createdAtMs)) {
          continue;
        }
        if (createdAtMs <= now - retentionMs) {
          state.aiInvocationTraces.delete(row.id);
          removed += 1;
        }
      }
      return removed;
    }
  };
}
