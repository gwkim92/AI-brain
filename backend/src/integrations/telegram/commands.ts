import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TelegramCommandInput = {
  text: string;
  actorId: string;
  chatId: string;
};

export type ParsedCommand =
  | { type: 'start'; proposalId: string }
  | { type: 'status_digest' }
  | { type: 'proposal_summary' }
  | { type: 'unknown' };

export type ProposalRecord = {
  id: string;
  status: string;
};

export type RunRecord = {
  id: string;
  proposalId: string;
  status: string;
};

export type UpgradeGateway = {
  findProposalById: (proposalId: string) => Promise<ProposalRecord | null>;
  createRun: (payload: { proposalId: string; startCommand: '작업 시작' }) => Promise<RunRecord>;
};

export type CommandResult =
  | { status: 'accepted'; type: 'start'; run: RunRecord }
  | { status: 'accepted'; type: 'status_digest' }
  | { status: 'accepted'; type: 'proposal_summary' }
  | { status: 'rejected'; reason: 'proposal_not_found' | 'proposal_not_approved' | 'invalid_command' };

const CALLBACK_TOKEN_VERSION = 'tcb1';
const CALLBACK_DEFAULT_TTL_SEC = 15 * 60;
const CALLBACK_TOKEN_DELIMITER = '|';

export type TelegramApprovalCallbackAction = 'approve' | 'approve_and_start';

export type TelegramCallbackReplayGuard = {
  consume: (nonce: string, expiresAtSec: number, nowMs?: number) => boolean;
};

export type TelegramApprovalCallbackValidationResult =
  | {
      accepted: true;
      action: TelegramApprovalCallbackAction;
      proposalId: string;
      nonce: string;
      expiresAtSec: number;
    }
  | {
      accepted: false;
      reason: 'invalid_payload' | 'missing_signature' | 'invalid_signature' | 'expired' | 'replayed';
    };

const ACTION_CODE_TO_NAME: Record<string, TelegramApprovalCallbackAction> = {
  a: 'approve',
  as: 'approve_and_start'
};

const ACTION_NAME_TO_CODE: Record<TelegramApprovalCallbackAction, string> = {
  approve: 'a',
  approve_and_start: 'as'
};

function buildCallbackSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url').slice(0, 22);
}

export function createTelegramApprovalCallbackData(input: {
  action: TelegramApprovalCallbackAction;
  proposalId: string;
  secret: string;
  nowMs?: number;
  expiresInSec?: number;
  nonce?: string;
}): string {
  const nowMs = input.nowMs ?? Date.now();
  const expiresInSec = input.expiresInSec ?? CALLBACK_DEFAULT_TTL_SEC;
  const expiresAtSec = Math.floor(nowMs / 1000) + Math.max(1, Math.floor(expiresInSec));
  const nonce = input.nonce ?? randomBytes(8).toString('hex');
  const actionCode = ACTION_NAME_TO_CODE[input.action];
  const payload = [CALLBACK_TOKEN_VERSION, actionCode, input.proposalId, String(expiresAtSec), nonce].join(
    CALLBACK_TOKEN_DELIMITER
  );
  const signature = buildCallbackSignature(payload, input.secret);
  return [payload, signature].join(CALLBACK_TOKEN_DELIMITER);
}

export function createTelegramCallbackReplayGuard(): TelegramCallbackReplayGuard {
  const seenNonceByExpiresAt = new Map<string, number>();

  const pruneExpired = (nowMs: number) => {
    for (const [nonce, expiresAtMs] of seenNonceByExpiresAt.entries()) {
      if (expiresAtMs <= nowMs) {
        seenNonceByExpiresAt.delete(nonce);
      }
    }
  };

  return {
    consume: (nonce: string, expiresAtSec: number, nowMs = Date.now()) => {
      pruneExpired(nowMs);
      if (seenNonceByExpiresAt.has(nonce)) {
        return false;
      }
      const expiresAtMs = expiresAtSec * 1000;
      seenNonceByExpiresAt.set(nonce, expiresAtMs);
      return true;
    }
  };
}

function safeVerifySignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function validateTelegramApprovalCallbackData(input: {
  data: string;
  secret: string;
  replayGuard?: TelegramCallbackReplayGuard;
  nowMs?: number;
}): TelegramApprovalCallbackValidationResult {
  const nowMs = input.nowMs ?? Date.now();
  const parts = input.data.split(CALLBACK_TOKEN_DELIMITER);
  if (parts.length < 5) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }
  if (parts.length === 5) {
    return {
      accepted: false,
      reason: 'missing_signature'
    };
  }
  if (parts.length !== 6) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  const [version, actionCode, proposalId, expiresAtRaw, nonce, signature] = parts;
  if (version !== CALLBACK_TOKEN_VERSION) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  const action = actionCode ? ACTION_CODE_TO_NAME[actionCode] : undefined;
  if (!action) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  if (!proposalId || !/^[a-zA-Z0-9-]{8,80}$/u.test(proposalId)) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  if (!nonce || !/^[a-f0-9]{8,64}$/u.test(nonce)) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  const expiresAtSec = Number.parseInt(expiresAtRaw ?? '', 10);
  if (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  const payload = [version, actionCode, proposalId, String(expiresAtSec), nonce].join(CALLBACK_TOKEN_DELIMITER);
  const expectedSignature = buildCallbackSignature(payload, input.secret);
  if (!signature || !safeVerifySignature(expectedSignature, signature)) {
    return {
      accepted: false,
      reason: 'invalid_signature'
    };
  }

  if (expiresAtSec * 1000 <= nowMs) {
    return {
      accepted: false,
      reason: 'expired'
    };
  }

  if (input.replayGuard && !input.replayGuard.consume(nonce, expiresAtSec, nowMs)) {
    return {
      accepted: false,
      reason: 'replayed'
    };
  }

  return {
    accepted: true,
    action,
    proposalId,
    nonce,
    expiresAtSec
  };
}

export function parseTelegramCommand(text: string): ParsedCommand {
  const normalized = text.trim();

  const startMatch = normalized.match(/^작업 시작\s+([a-zA-Z0-9_-]+)$/u);
  if (startMatch) {
    return {
      type: 'start',
      proposalId: startMatch[1]!
    };
  }

  if (normalized === '상태 요약') {
    return { type: 'status_digest' };
  }

  if (normalized === '제안 요약') {
    return { type: 'proposal_summary' };
  }

  return { type: 'unknown' };
}

export async function handleTelegramCommand(
  input: TelegramCommandInput,
  gateway: UpgradeGateway
): Promise<CommandResult> {
  const parsed = parseTelegramCommand(input.text);

  if (parsed.type === 'unknown') {
    return {
      status: 'rejected',
      reason: 'invalid_command'
    };
  }

  if (parsed.type === 'status_digest') {
    return {
      status: 'accepted',
      type: 'status_digest'
    };
  }

  if (parsed.type === 'proposal_summary') {
    return {
      status: 'accepted',
      type: 'proposal_summary'
    };
  }

  const proposal = await gateway.findProposalById(parsed.proposalId);
  if (!proposal) {
    return {
      status: 'rejected',
      reason: 'proposal_not_found'
    };
  }

  if (proposal.status !== 'approved') {
    return {
      status: 'rejected',
      reason: 'proposal_not_approved'
    };
  }

  const run = await gateway.createRun({
    proposalId: parsed.proposalId,
    startCommand: '작업 시작'
  });

  return {
    status: 'accepted',
    type: 'start',
    run
  };
}
