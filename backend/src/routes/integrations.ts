import type { FastifyInstance } from 'fastify';
import { sendError, sendSuccess } from '../lib/http';
import { handleResponsesWebhook } from '../integrations/openai/webhook-handler';
import {
  handleTelegramCommand,
  validateTelegramApprovalCallbackData
} from '../integrations/telegram/commands';
import type { RouteContext } from './types';

export async function integrationRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, telegramCallbackReplayGuard } = ctx;

  app.post('/api/v1/integrations/openai/webhook', async (request, reply) => {
    const signature = request.headers['x-jarvis-openai-signature'];
    if (!env.OPENAI_WEBHOOK_SECRET) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'OPENAI_WEBHOOK_SECRET not configured');
    }

    const rawBody = JSON.stringify(request.body ?? {});
    const result = await handleResponsesWebhook(
      { rawBody, signature: typeof signature === 'string' ? signature : undefined, secret: env.OPENAI_WEBHOOK_SECRET },
      { async onEvent() { return; } }
    );

    if (!result.accepted) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'webhook rejected', { reason: result.reason });
    }
    return sendSuccess(reply, request, 200, { accepted: true });
  });

  app.post('/api/v1/integrations/telegram/webhook', async (request, reply) => {
    const secretToken = request.headers['x-telegram-bot-api-secret-token'];
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'TELEGRAM_WEBHOOK_SECRET not configured');
    }
    if (typeof secretToken !== 'string' || secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'invalid telegram webhook secret');
    }

    const body = request.body as {
      message?: { text?: string };
      callback_query?: { data?: string };
    };

    const callbackData = body?.callback_query?.data?.trim();
    if (callbackData) {
      const callbackValidation = validateTelegramApprovalCallbackData({
        data: callbackData,
        secret: env.TELEGRAM_WEBHOOK_SECRET,
        replayGuard: telegramCallbackReplayGuard
      });

      if (!callbackValidation.accepted) {
        return sendSuccess(reply, request, 200, { accepted: false, ignored: true, reason: callbackValidation.reason });
      }

      const proposalId = callbackValidation.proposalId;
      const approved = await store.decideUpgradeProposal(proposalId, 'approve', 'telegram_callback');
      if (!approved) {
        return sendSuccess(reply, request, 200, { accepted: false, reason: 'proposal_not_found', proposal_id: proposalId });
      }

      if (callbackValidation.action === 'approve_and_start') {
        const run = await store.createUpgradeRun({ proposalId, startCommand: '작업 시작' });
        return sendSuccess(reply, request, 200, { accepted: true, type: 'approve_and_start', proposal_id: proposalId, run_id: run.id });
      }

      return sendSuccess(reply, request, 200, { accepted: true, type: 'approve', proposal_id: proposalId });
    }

    const text = body?.message?.text;
    if (!text) {
      return sendSuccess(reply, request, 200, { accepted: true, ignored: true });
    }

    const commandResult = await handleTelegramCommand(
      { text, actorId: env.DEFAULT_USER_ID, chatId: 'telegram' },
      {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) return null;
          return { id: proposal.id, status: proposal.status };
        },
        createRun: async (payload: { proposalId: string; startCommand: '작업 시작' }) => {
          const run = await store.createUpgradeRun(payload);
          return { id: run.id, proposalId: run.proposalId, status: run.status };
        }
      }
    );

    return sendSuccess(reply, request, 200, commandResult);
  });
}
