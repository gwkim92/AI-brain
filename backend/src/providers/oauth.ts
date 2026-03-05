import { createHash, randomBytes } from 'node:crypto';

import type { AppEnv } from '../config/env';
import type { ProviderCredentialProvider } from '../store/types';

import { buildProviderHttpError, withReasonAwareRetry } from './retry';

export type SupportedOauthProvider = Extract<ProviderCredentialProvider, 'openai' | 'gemini'>;

export type ProviderOauthConfig = {
  provider: SupportedOauthProvider;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
  publicClientFallback: boolean;
};

export type ProviderOauthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: string | null;
  tokenType?: string;
  scope?: string;
};

const OPENAI_PUBLIC_CLIENT_FALLBACK = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  clientSecret: '',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access'
} as const;

const GEMINI_PUBLIC_CLIENT_FALLBACK = {
  clientId: '',
  clientSecret: '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  redirectUri: 'http://localhost:8085/oauth2callback',
  scopes: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
} as const;

function parseScopes(raw: string): string[] {
  return Array.from(new Set(raw.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean)));
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return false;
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) {
    return true;
  }
  if (normalized.startsWith('172.')) {
    const secondOctet = Number.parseInt(normalized.split('.')[1] ?? '', 10);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

export function assertSafeOauthEndpoint(urlRaw: string, env: AppEnv, fieldName: string): void {
  const url = new URL(urlRaw);
  const hostname = url.hostname;
  const isHttps = url.protocol === 'https:';
  const isLocalHttp = url.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');

  if (!isHttps && !isLocalHttp) {
    throw new Error(`unsafe ${fieldName}: only https endpoints are allowed (except localhost http)`);
  }

  if (env.NODE_ENV === 'production') {
    if (!isHttps) {
      throw new Error(`unsafe ${fieldName}: production requires https endpoint`);
    }
    if (isUnsafeHostname(hostname)) {
      throw new Error(`unsafe ${fieldName}: private network host is not allowed in production`);
    }
  }
}

export function getProviderOauthConfig(
  env: AppEnv,
  provider: SupportedOauthProvider
): ProviderOauthConfig | null {
  if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
    return null;
  }

  if (provider === 'openai' && !env.PROVIDER_OAUTH_OPENAI_ENABLED) {
    return null;
  }
  if (provider === 'gemini' && !env.PROVIDER_OAUTH_GEMINI_ENABLED) {
    return null;
  }

  const fallbackAllowed = env.PROVIDER_OAUTH_PUBLIC_CLIENT_FALLBACK;

  if (provider === 'openai') {
    const configuredClientId = env.OPENAI_OAUTH_CLIENT_ID?.trim() ?? '';
    const configuredClientSecret = env.OPENAI_OAUTH_CLIENT_SECRET?.trim() ?? '';
    const configuredRedirectUri = env.OPENAI_OAUTH_REDIRECT_URI?.trim() ?? '';
    const usePublicFallback = fallbackAllowed && !configuredClientId && !configuredRedirectUri;
    const clientId = configuredClientId || (usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.clientId : '');
    const clientSecret = configuredClientSecret || (usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.clientSecret : '');
    const redirectUri = configuredRedirectUri || (usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.redirectUri : '');
    if (!clientId || !redirectUri) {
      return null;
    }
    if (!clientSecret && !fallbackAllowed) {
      return null;
    }

    const authUrl = usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.authUrl : env.OPENAI_OAUTH_AUTH_URL;
    const tokenUrl = usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.tokenUrl : env.OPENAI_OAUTH_TOKEN_URL;
    assertSafeOauthEndpoint(authUrl, env, 'OPENAI_OAUTH_AUTH_URL');
    assertSafeOauthEndpoint(tokenUrl, env, 'OPENAI_OAUTH_TOKEN_URL');

    const scopes = parseScopes(usePublicFallback ? OPENAI_PUBLIC_CLIENT_FALLBACK.scopes : env.OPENAI_OAUTH_SCOPES);
    return {
      provider,
      clientId,
      clientSecret,
      authUrl,
      tokenUrl,
      redirectUri,
      scopes,
      publicClientFallback: usePublicFallback
    };
  }

  const configuredClientId = env.GEMINI_OAUTH_CLIENT_ID?.trim() ?? '';
  const configuredClientSecret = env.GEMINI_OAUTH_CLIENT_SECRET?.trim() ?? '';
  const configuredRedirectUri = env.GEMINI_OAUTH_REDIRECT_URI?.trim() ?? '';
  const usePublicFallback = fallbackAllowed && !configuredClientId && !configuredRedirectUri;
  const clientId = configuredClientId || (usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.clientId : '');
  const clientSecret = configuredClientSecret || (usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.clientSecret : '');
  const redirectUri = configuredRedirectUri || (usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.redirectUri : '');
  if (!clientId || !redirectUri) {
    return null;
  }
  if (!clientSecret && !fallbackAllowed) {
    return null;
  }

  const authUrl = usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.authUrl : env.GEMINI_OAUTH_AUTH_URL;
  const tokenUrl = usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.tokenUrl : env.GEMINI_OAUTH_TOKEN_URL;
  assertSafeOauthEndpoint(authUrl, env, 'GEMINI_OAUTH_AUTH_URL');
  assertSafeOauthEndpoint(tokenUrl, env, 'GEMINI_OAUTH_TOKEN_URL');

  const scopes = parseScopes(usePublicFallback ? GEMINI_PUBLIC_CLIENT_FALLBACK.scopes : env.GEMINI_OAUTH_SCOPES);
  return {
    provider,
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
    redirectUri,
    scopes,
    publicClientFallback: usePublicFallback
  };
}

export function getProviderOauthCallbackOrigins(config: ProviderOauthConfig): string[] {
  try {
    return [new URL(config.redirectUri).origin];
  } catch {
    return [];
  }
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return {
    codeVerifier,
    codeChallenge
  };
}

export function buildProviderAuthorizationUrl(input: {
  config: ProviderOauthConfig;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.config.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  if (input.config.scopes.length > 0) {
    url.searchParams.set('scope', input.config.scopes.join(' '));
  }

  if (input.config.provider === 'openai' && input.config.publicClientFallback) {
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('originator', 'codex_cli_rs');
  }
  if (input.config.provider === 'gemini') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
  }

  return url.toString();
}

function normalizeExpiresAt(expiresIn: unknown): string | null {
  const numeric =
    typeof expiresIn === 'number'
      ? expiresIn
      : typeof expiresIn === 'string'
        ? Number.parseFloat(expiresIn)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return new Date(Date.now() + numeric * 1000).toISOString();
}

function parseTokenResponse(raw: string): ProviderOauthTokenSet {
  const parsed = JSON.parse(raw) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    token_type?: string;
    scope?: string;
  };

  const accessToken = parsed.access_token?.trim();
  if (!accessToken) {
    throw new Error('oauth token response missing access_token');
  }

  return {
    accessToken,
    refreshToken: parsed.refresh_token?.trim() || undefined,
    accessTokenExpiresAt: normalizeExpiresAt(parsed.expires_in),
    tokenType: parsed.token_type?.trim() || undefined,
    scope: parsed.scope?.trim() || undefined
  };
}

async function tokenRequest(
  config: ProviderOauthConfig,
  params: URLSearchParams,
  onRetry?: (input: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void
): Promise<ProviderOauthTokenSet> {
  const raw = await withReasonAwareRetry(
    async () => {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw buildProviderHttpError({
          provider: config.provider,
          status: response.status,
          statusText: response.statusText,
          bodyText,
          retryAfterHeader: response.headers.get('retry-after')
        });
      }

      return bodyText;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 400,
      maxDelayMs: 8000,
      provider: config.provider,
      onRetry: (event) => {
        onRetry?.({
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          reason: event.reason
        });
      }
    }
  );

  return parseTokenResponse(raw);
}

export async function exchangeAuthorizationCode(input: {
  config: ProviderOauthConfig;
  code: string;
  codeVerifier: string;
  onRetry?: (input: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void;
}): Promise<ProviderOauthTokenSet> {
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', input.code);
  params.set('redirect_uri', input.config.redirectUri);
  params.set('client_id', input.config.clientId);
  if (input.config.clientSecret) {
    params.set('client_secret', input.config.clientSecret);
  }
  params.set('code_verifier', input.codeVerifier);

  return tokenRequest(input.config, params, input.onRetry);
}

export async function refreshAccessToken(input: {
  config: ProviderOauthConfig;
  refreshToken: string;
  scope?: string;
  onRetry?: (input: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void;
}): Promise<ProviderOauthTokenSet> {
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', input.refreshToken);
  params.set('client_id', input.config.clientId);
  if (input.config.clientSecret) {
    params.set('client_secret', input.config.clientSecret);
  }
  if (input.scope) {
    params.set('scope', input.scope);
  }

  return tokenRequest(input.config, params, input.onRetry);
}
