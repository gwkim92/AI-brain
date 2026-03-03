import { randomUUID } from 'node:crypto';

import type {
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
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
    }
  };
}
