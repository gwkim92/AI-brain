import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../auth/crypto';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const AuthSignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  display_name: z.string().min(1).max(120).optional()
});

const AuthLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200)
});

export async function authRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, resolveRequestUserId } = ctx;

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
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await store.createAuthSession({ userId: created.id, tokenHash, expiresAt });

    return sendSuccess(reply, request, 201, {
      user: { id: created.id, email: created.email, role: created.role, display_name: created.displayName },
      token: rawToken
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
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await store.createAuthSession({ userId: user.id, tokenHash, expiresAt });

    return sendSuccess(reply, request, 200, {
      user: { id: user.id, email: user.email, role: user.role, display_name: user.displayName },
      token: rawToken
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
      user: { id: user.id, email: user.email, role: user.role, display_name: user.displayName }
    });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = ctx.getRequestAuthContext(request);
    if (auth?.authType === 'session' && auth.tokenHash) {
      await store.revokeAuthSession(auth.tokenHash);
    }

    return sendSuccess(reply, request, 200, { logged_out: true });
  });
}
