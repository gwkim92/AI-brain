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
