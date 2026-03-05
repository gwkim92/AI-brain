import { decryptSecretValue, encryptSecretValue } from '../auth/secrets';
import type { AppEnv } from '../config/env';
import type {
  JarvisStore,
  ProviderCredentialMode as StoreProviderCredentialMode,
  ProviderCredentialPriority as StoreProviderCredentialPriority,
  ProviderCredentialProvider,
  UserProviderCredentialRecord
} from '../store/types';

import { getProviderOauthConfig, refreshAccessToken, type SupportedOauthProvider } from './oauth';
import type {
  ProviderCredentialMode,
  ProviderCredentialPriority,
  ProviderCredentialsByProvider,
  ProviderName,
  ProviderResolvedCredential
} from './types';

const PROVIDER_ORDER: ProviderName[] = ['openai', 'gemini', 'anthropic', 'local'];
const REFRESH_SKEW_MS = 120_000;

type OauthCredentialBucket = {
  access_token?: string;
  refresh_token?: string;
  access_token_expires_at?: string | null;
  token_type?: string;
  scope?: string;
};

export type UserProviderCredentialPayload = {
  selected_credential_mode?: StoreProviderCredentialMode;
  credential_priority?: ProviderCredentialPriority;
  api_key?: string;
  oauth_official?: OauthCredentialBucket;
};

type LegacyUserProviderCredentialPayload = {
  selected_credential_mode?: string;
  credential_priority?: ProviderCredentialPriority;
  api_key?: string;
  oauth?: OauthCredentialBucket;
  auth_gateway?: OauthCredentialBucket;
  oauth_official?: OauthCredentialBucket;
  oauth_gateway?: OauthCredentialBucket;
};

export type ProviderCredentialResolution = {
  credentialsByProvider: ProviderCredentialsByProvider;
  userCredentials: Partial<
    Record<
      ProviderName,
      {
        record: UserProviderCredentialRecord;
        payload: UserProviderCredentialPayload | null;
      }
    >
  >;
};

function normalizePriority(input: unknown): ProviderCredentialPriority {
  return input === 'auth_first' ? 'auth_first' : 'api_key_first';
}

function normalizeSelectedMode(input: unknown): StoreProviderCredentialMode {
  if (input === 'api_key' || input === 'oauth_official') {
    return input;
  }
  if (input === 'oauth_token') {
    return 'oauth_official';
  }
  if (input === 'auth_gateway' || input === 'oauth_gateway') {
    return 'oauth_official';
  }
  return 'auto';
}

function normalizeIsoDate(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function trimOptional(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOauthBucket(raw: OauthCredentialBucket | undefined): OauthCredentialBucket | undefined {
  const accessToken = trimOptional(raw?.access_token);
  if (!accessToken) {
    return undefined;
  }

  return {
    access_token: accessToken,
    refresh_token: trimOptional(raw?.refresh_token),
    access_token_expires_at: normalizeIsoDate(raw?.access_token_expires_at),
    token_type: trimOptional(raw?.token_type),
    scope: trimOptional(raw?.scope)
  };
}

export function parseUserProviderCredentialPayload(raw: string): UserProviderCredentialPayload | null {
  try {
    const parsed = JSON.parse(raw) as LegacyUserProviderCredentialPayload;
    const legacyOauth = normalizeOauthBucket(parsed.oauth);
    const legacyGateway = normalizeOauthBucket(parsed.oauth_gateway ?? parsed.auth_gateway);
    const nextPayload: UserProviderCredentialPayload = {
      selected_credential_mode: normalizeSelectedMode(parsed.selected_credential_mode),
      credential_priority: normalizePriority(parsed.credential_priority),
      api_key: trimOptional(parsed.api_key),
      oauth_official: normalizeOauthBucket(parsed.oauth_official) ?? legacyOauth ?? legacyGateway
    };
    return nextPayload;
  } catch {
    return null;
  }
}

export function serializeUserProviderCredentialPayload(payload: UserProviderCredentialPayload): string {
  return JSON.stringify({
    selected_credential_mode: normalizeSelectedMode(payload.selected_credential_mode),
    credential_priority: normalizePriority(payload.credential_priority),
    api_key: trimOptional(payload.api_key),
    oauth_official: normalizeOauthBucket(payload.oauth_official)
  });
}

function getEnvProviderApiKey(env: AppEnv, provider: ProviderName): string | undefined {
  if (provider === 'openai') return env.OPENAI_API_KEY;
  if (provider === 'gemini') return env.GEMINI_API_KEY;
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY;
  return env.LOCAL_LLM_API_KEY;
}

function shouldRefreshAccessToken(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs - Date.now() <= REFRESH_SKEW_MS;
}

function pickUserResolvedCredential(input: {
  provider: ProviderName;
  payload: UserProviderCredentialPayload | null;
  priority: ProviderCredentialPriority;
}): ProviderResolvedCredential | null {
  const payload = input.payload;
  if (!payload) {
    return null;
  }

  const selectedMode = normalizeSelectedMode(payload.selected_credential_mode);
  const candidates: ProviderCredentialMode[] =
    selectedMode === 'auto'
      ? input.priority === 'auth_first'
        ? ['oauth_official', 'api_key']
        : ['api_key', 'oauth_official']
      : [selectedMode];

  for (const mode of candidates) {
    if (mode === 'api_key' && payload.api_key) {
      return {
        provider: input.provider,
        source: 'user',
        selectedCredentialMode: 'api_key',
        credentialPriority: input.priority,
        apiKey: payload.api_key,
        authAccessTokenExpiresAt: null
      };
    }

    if (mode === 'oauth_official' && payload.oauth_official?.access_token) {
      return {
        provider: input.provider,
        source: 'user',
        selectedCredentialMode: 'oauth_official',
        credentialPriority: input.priority,
        oauthAccessToken: payload.oauth_official.access_token,
        oauthRefreshToken: payload.oauth_official.refresh_token,
        oauthScope: payload.oauth_official.scope,
        oauthTokenType: payload.oauth_official.token_type,
        authAccessTokenExpiresAt: payload.oauth_official.access_token_expires_at ?? null
      };
    }

  }

  return null;
}

async function maybeRefreshOauthCredentialBucket(input: {
  store: JarvisStore;
  env: AppEnv;
  userId: string;
  provider: ProviderName;
  payload: UserProviderCredentialPayload;
  updatedBy?: string | null;
  bucketKey: 'oauth_official';
  onAuthEvent?: (event: {
    provider: ProviderName;
    stage: 'refresh_start' | 'refresh_complete' | 'refresh_failed';
    reason?: string;
  }) => void;
}): Promise<UserProviderCredentialPayload> {
  const bucket = input.payload[input.bucketKey];
  if (!bucket?.access_token || !bucket.refresh_token) {
    return input.payload;
  }

  if (!shouldRefreshAccessToken(bucket.access_token_expires_at)) {
    return input.payload;
  }

  if (input.provider !== 'openai' && input.provider !== 'gemini') {
    return input.payload;
  }

  const config = getProviderOauthConfig(input.env, input.provider as SupportedOauthProvider);
  if (!config) {
    return input.payload;
  }

  input.onAuthEvent?.({ provider: input.provider, stage: 'refresh_start' });

  try {
    const refreshed = await refreshAccessToken({
      config,
      refreshToken: bucket.refresh_token,
      scope: bucket.scope
    });

    const nextBucket = {
      ...bucket,
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken ?? bucket.refresh_token,
      access_token_expires_at: refreshed.accessTokenExpiresAt,
      token_type: refreshed.tokenType ?? bucket.token_type,
      scope: refreshed.scope ?? bucket.scope
    };
    const nextPayload: UserProviderCredentialPayload = {
      ...input.payload,
      [input.bucketKey]: nextBucket
    };

    const encrypted = encryptSecretValue(serializeUserProviderCredentialPayload(nextPayload), input.env.SECRETS_ENCRYPTION_KEY);
    await input.store.upsertUserProviderCredential({
      userId: input.userId,
      provider: input.provider,
      encryptedPayload: encrypted,
      isActive: true,
      updatedBy: input.updatedBy ?? null
    });

    input.onAuthEvent?.({ provider: input.provider, stage: 'refresh_complete' });
    return nextPayload;
  } catch (error) {
    input.onAuthEvent?.({
      provider: input.provider,
      stage: 'refresh_failed',
      reason: error instanceof Error ? error.message : String(error)
    });
    return input.payload;
  }
}

function safeDecrypt(input: { encryptedValue: string; secret: string }): string | null {
  try {
    return decryptSecretValue(input.encryptedValue, input.secret);
  } catch {
    return null;
  }
}

function buildCredentialWithoutMaterial(
  provider: ProviderName,
  priority: ProviderCredentialPriority,
  source: ProviderResolvedCredential['source'] = 'none'
): ProviderResolvedCredential {
  return {
    provider,
    source,
    selectedCredentialMode: null,
    credentialPriority: priority,
    authAccessTokenExpiresAt: null
  };
}

export async function resolveEffectiveProviderCredentials(input: {
  store: JarvisStore;
  env: AppEnv;
  userId: string;
  updatedBy?: string | null;
  onAuthEvent?: (event: {
    provider: ProviderName;
    stage: 'refresh_start' | 'refresh_complete' | 'refresh_failed';
    reason?: string;
  }) => void;
}): Promise<ProviderCredentialResolution> {
  const [workspaceRows, userRows] = await Promise.all([
    input.store.listProviderCredentials(),
    input.store.listUserProviderCredentials({ userId: input.userId, includeInactive: true })
  ]);

  const workspaceKeyByProvider = new Map<ProviderName, string>();
  for (const row of workspaceRows) {
    const decrypted = safeDecrypt({
      encryptedValue: row.encryptedApiKey,
      secret: input.env.SECRETS_ENCRYPTION_KEY
    });
    if (!decrypted) {
      continue;
    }
    const trimmed = decrypted.trim();
    if (!trimmed) {
      continue;
    }
    workspaceKeyByProvider.set(row.provider as ProviderName, trimmed);
  }

  const userCredentials: ProviderCredentialResolution['userCredentials'] = {};
  for (const row of userRows) {
    const provider = row.provider as ProviderName;
    const decryptedPayload = safeDecrypt({
      encryptedValue: row.encryptedPayload,
      secret: input.env.SECRETS_ENCRYPTION_KEY
    });
    userCredentials[provider] = {
      record: row,
      payload: decryptedPayload ? parseUserProviderCredentialPayload(decryptedPayload) : null
    };
  }

  const credentialsByProvider: ProviderCredentialsByProvider = {};

  for (const provider of PROVIDER_ORDER) {
    const userSnapshot = userCredentials[provider];
    let payload = userSnapshot?.payload ?? null;
    const priority = normalizePriority(payload?.credential_priority) as StoreProviderCredentialPriority;
    const selectedMode = normalizeSelectedMode(payload?.selected_credential_mode);

    if (payload && userSnapshot?.record.isActive) {
      payload = await maybeRefreshOauthCredentialBucket({
        store: input.store,
        env: input.env,
        userId: input.userId,
        provider,
        payload,
        updatedBy: input.updatedBy,
        bucketKey: 'oauth_official',
        onAuthEvent: input.onAuthEvent
      });
      userCredentials[provider] = {
        record: userSnapshot.record,
        payload
      };
    }

    const pickedUser = userSnapshot?.record.isActive
      ? pickUserResolvedCredential({
          provider,
          payload,
          priority
        })
      : null;

    if (pickedUser) {
      credentialsByProvider[provider] = pickedUser;
      continue;
    }

    if (userSnapshot?.record.isActive && selectedMode !== 'auto') {
      credentialsByProvider[provider] = buildCredentialWithoutMaterial(provider, priority, 'user');
      continue;
    }

    const workspaceKey = workspaceKeyByProvider.get(provider);
    if (workspaceKey) {
      credentialsByProvider[provider] = {
        provider,
        source: 'workspace',
        selectedCredentialMode: 'api_key',
        credentialPriority: priority,
        apiKey: workspaceKey,
        authAccessTokenExpiresAt: null
      };
      continue;
    }

    const envKey = getEnvProviderApiKey(input.env, provider)?.trim();
    if (envKey) {
      credentialsByProvider[provider] = {
        provider,
        source: 'env',
        selectedCredentialMode: 'api_key',
        credentialPriority: priority,
        apiKey: envKey,
        authAccessTokenExpiresAt: null
      };
      continue;
    }

    credentialsByProvider[provider] = buildCredentialWithoutMaterial(provider, priority, 'none');
  }

  return {
    credentialsByProvider,
    userCredentials
  };
}

export function normalizeCredentialProvider(value: string): ProviderCredentialProvider | null {
  if (value === 'openai' || value === 'gemini' || value === 'anthropic' || value === 'local') {
    return value;
  }
  return null;
}
