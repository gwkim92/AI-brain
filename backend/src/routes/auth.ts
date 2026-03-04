import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../auth/crypto';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const AUTH_COOKIE_NAME = 'jarvis_auth_token';

const AuthSignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  display_name: z.string().min(1).max(120).optional()
});

const AuthLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200)
});

const AuthStaticTokenLoginSchema = z.object({
  token: z.string().min(8).max(500)
});

function buildAuthCookie(input: {
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  const maxAge = Number.isFinite(input.maxAgeSeconds) && input.maxAgeSeconds > 0
    ? Math.floor(input.maxAgeSeconds)
    : 60 * 60 * 24 * 7;
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(input.token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    input.secure ? 'Secure' : null
  ]
    .filter((item): item is string => Boolean(item))
    .join('; ');
}

function buildAuthCookieClear(secure: boolean): string {
  return [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : null
  ]
    .filter((item): item is string => Boolean(item))
    .join('; ');
}

export async function authRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env } = ctx;
  const sessionTtlMs = env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000;
  const sessionTtlSec = Math.max(60, Math.floor(sessionTtlMs / 1000));
  const cookieSecure = env.NODE_ENV === 'production';
  const authTokenConfigured = Boolean(env.AUTH_TOKEN?.trim());

  app.get('/api/v1/auth/config', async (request, reply) => {
    return sendSuccess(reply, request, 200, {
      auth_required: env.AUTH_REQUIRED,
      auth_allow_signup: env.AUTH_ALLOW_SIGNUP,
      auth_token_configured: authTokenConfigured
    });
  });

  app.post('/api/v1/auth/signup', async (request, reply) => {
    if (!env.AUTH_ALLOW_SIGNUP) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'signup is disabled');
    }

    const parsed = AuthSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid signup payload', parsed.error.flatten());
    }

    const created = await store.createAuthUser({
      email: parsed.data.email.trim().toLowerCase(),
      displayName: parsed.data.display_name ?? parsed.data.email.split('@')[0] ?? 'user',
      passwordHash: hashPassword(parsed.data.password),
      role: 'member'
    });

    if (!created) {
      return sendError(reply, request, 409, 'CONFLICT', 'email already registered');
    }

    const rawToken = createSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    await store.createAuthSession({ userId: created.id, tokenHash, expiresAt });
    reply.header('Set-Cookie', buildAuthCookie({ token: rawToken, maxAgeSeconds: sessionTtlSec, secure: cookieSecure }));

    return sendSuccess(reply, request, 201, {
      user: { id: created.id, email: created.email, role: created.role, display_name: created.displayName },
      token: rawToken,
      expires_at: expiresAt
    });
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = AuthLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid login payload', parsed.error.flatten());
    }

    const user = await store.findAuthUserByEmail(parsed.data.email.trim().toLowerCase());
    if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'invalid credentials');
    }

    const rawToken = createSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    await store.createAuthSession({ userId: user.id, tokenHash, expiresAt });
    reply.header('Set-Cookie', buildAuthCookie({ token: rawToken, maxAgeSeconds: sessionTtlSec, secure: cookieSecure }));

    return sendSuccess(reply, request, 200, {
      user: { id: user.id, email: user.email, role: user.role, display_name: user.displayName },
      token: rawToken,
      expires_at: expiresAt
    });
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    const auth = ctx.getRequestAuthContext(request);
    if (!auth || auth.authType !== 'session') {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'no active session');
    }

    const user = await store.getAuthUserById(auth.userId);
    if (!user) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'user not found');
    }

    return sendSuccess(reply, request, 200, {
      user: { id: user.id, email: user.email, role: user.role, display_name: user.displayName },
      auth_type: auth.authType
    });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = ctx.getRequestAuthContext(request);
    let revoked = false;
    if (auth?.authType === 'session' && auth.tokenHash) {
      revoked = await store.revokeAuthSession(auth.tokenHash);
    }
    reply.header('Set-Cookie', buildAuthCookieClear(cookieSecure));

    return sendSuccess(reply, request, 200, { revoked });
  });

  app.post('/api/v1/auth/static-token/login', async (request, reply) => {
    if (!authTokenConfigured) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'static token login is disabled');
    }

    const parsed = AuthStaticTokenLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid static token login payload', parsed.error.flatten());
    }

    const configured = env.AUTH_TOKEN?.trim();
    if (!configured || parsed.data.token.trim() !== configured) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'invalid static token');
    }

    reply.header('Set-Cookie', buildAuthCookie({ token: configured, maxAgeSeconds: sessionTtlSec, secure: cookieSecure }));
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();

    return sendSuccess(reply, request, 200, {
      user: {
        id: env.DEFAULT_USER_ID,
        email: env.DEFAULT_USER_EMAIL,
        role: 'admin',
        display_name: env.ADMIN_BOOTSTRAP_DISPLAY_NAME
      },
      auth_type: 'static_token',
      expires_at: expiresAt
    });
  });
}
