import type { Pool } from 'pg';

import type {
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
  UserRole
} from '../types';
import type { AuthRepositoryContract } from '../repository-contracts';
import type { AuthSessionRow, AuthUserRow, ProviderCredentialRow } from './types';

type AuthRepositoryDeps = {
  pool: Pool;
};

function mapAuthUserRow(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapAuthUserWithPasswordRow(row: AuthUserRow): AuthUserWithPasswordRecord {
  return {
    ...mapAuthUserRow(row),
    passwordHash: row.password_hash
  };
}

export function createAuthRepository({ pool }: AuthRepositoryDeps): AuthRepositoryContract {
  return {
    async createAuthUser(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role?: UserRole;
    }): Promise<AuthUserRecord | null> {
      const email = input.email.trim().toLowerCase();
      try {
        const { rows } = await pool.query<AuthUserRow>(
          `
            INSERT INTO users (email, display_name, role, password_hash)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, display_name, role, password_hash, created_at, updated_at
          `,
          [email, input.displayName?.trim() || null, input.role ?? 'member', input.passwordHash]
        );

        return rows[0] ? mapAuthUserRow(rows[0]) : null;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : '';
        if (code === '23505') {
          return null;
        }
        throw error;
      }
    },

    async upsertAuthUserByEmail(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role: UserRole;
    }): Promise<AuthUserRecord> {
      const email = input.email.trim().toLowerCase();
      const { rows } = await pool.query<AuthUserRow>(
        `
          INSERT INTO users (email, display_name, role, password_hash)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO UPDATE
          SET
            display_name = COALESCE(EXCLUDED.display_name, users.display_name),
            role = EXCLUDED.role,
            password_hash = EXCLUDED.password_hash,
            updated_at = now()
          RETURNING id, email, display_name, role, password_hash, created_at, updated_at
        `,
        [email, input.displayName?.trim() || null, input.role, input.passwordHash]
      );

      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert auth user');
      }

      return mapAuthUserRow(row);
    },

    async findAuthUserByEmail(email: string): Promise<AuthUserWithPasswordRecord | null> {
      const { rows } = await pool.query<AuthUserRow>(
        `
          SELECT id, email, display_name, role, password_hash, created_at, updated_at
          FROM users
          WHERE lower(email) = lower($1)
          LIMIT 1
        `,
        [email.trim().toLowerCase()]
      );
      return rows[0] ? mapAuthUserWithPasswordRow(rows[0]) : null;
    },

    async getAuthUserById(userId: string): Promise<AuthUserRecord | null> {
      const { rows } = await pool.query<AuthUserRow>(
        `
          SELECT id, email, display_name, role, password_hash, created_at, updated_at
          FROM users
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [userId]
      );
      return rows[0] ? mapAuthUserRow(rows[0]) : null;
    },

    async createAuthSession(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<void> {
      await pool.query(
        `
          INSERT INTO user_sessions (user_id, token_hash, expires_at)
          VALUES ($1::uuid, $2, $3::timestamptz)
        `,
        [input.userId, input.tokenHash, input.expiresAt]
      );
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
      const { rows } = await pool.query<AuthSessionRow>(
        `
          SELECT
            s.token_hash,
            s.expires_at,
            s.revoked_at,
            u.id AS user_id,
            u.email,
            u.display_name,
            u.role,
            u.created_at,
            u.updated_at
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      const row = rows[0];
      if (!row || row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
        return null;
      }

      await pool.query(
        `
          UPDATE user_sessions
          SET last_seen_at = now()
          WHERE token_hash = $1
        `,
        [tokenHash]
      );

      return {
        user: mapAuthUserRow({
          id: row.user_id,
          email: row.email,
          display_name: row.display_name,
          role: row.role,
          password_hash: null,
          created_at: row.created_at,
          updated_at: row.updated_at
        }),
        tokenHash: row.token_hash,
        expiresAt: row.expires_at.toISOString()
      };
    },

    async revokeAuthSession(tokenHash: string): Promise<boolean> {
      const { rowCount } = await pool.query(
        `
          UPDATE user_sessions
          SET revoked_at = now()
          WHERE token_hash = $1
            AND revoked_at IS NULL
        `,
        [tokenHash]
      );
      return (rowCount ?? 0) > 0;
    },

    async listProviderCredentials() {
      const { rows } = await pool.query<ProviderCredentialRow>(
        `
          SELECT provider, encrypted_api_key, updated_by, updated_at
          FROM provider_credentials
          ORDER BY provider ASC
        `
      );
      return rows.map((row) => ({
        provider: row.provider,
        encryptedApiKey: row.encrypted_api_key,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString()
      }));
    },

    async upsertProviderCredential(input: {
      provider: 'openai' | 'gemini' | 'anthropic' | 'local';
      encryptedApiKey: string;
      updatedBy?: string | null;
    }) {
      const { rows } = await pool.query<ProviderCredentialRow>(
        `
          INSERT INTO provider_credentials (provider, encrypted_api_key, updated_by)
          VALUES ($1, $2, $3::uuid)
          ON CONFLICT (provider) DO UPDATE
          SET
            encrypted_api_key = EXCLUDED.encrypted_api_key,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING provider, encrypted_api_key, updated_by, updated_at
        `,
        [input.provider, input.encryptedApiKey, input.updatedBy ?? null]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert provider credential');
      }
      return {
        provider: row.provider,
        encryptedApiKey: row.encrypted_api_key,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString()
      };
    },

    async deleteProviderCredential(provider: 'openai' | 'gemini' | 'anthropic' | 'local'): Promise<boolean> {
      const { rowCount } = await pool.query(
        `
          DELETE FROM provider_credentials
          WHERE provider = $1
        `,
        [provider]
      );
      return (rowCount ?? 0) > 0;
    }
  };
}
