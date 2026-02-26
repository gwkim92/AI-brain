import { describe, expect, it } from 'vitest';

import {
  createTelegramApprovalCallbackData,
  createTelegramCallbackReplayGuard,
  validateTelegramApprovalCallbackData
} from '../commands';

const SECRET = 'telegram-test-secret';
const PROPOSAL_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('telegram callback security', () => {
  it('accepts signed callback payload', () => {
    const nowMs = 1_700_000_000_000;
    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve_and_start',
      proposalId: PROPOSAL_ID,
      secret: SECRET,
      nowMs,
      expiresInSec: 600,
      nonce: 'a1b2c3d4e5f60708'
    });

    const result = validateTelegramApprovalCallbackData({
      data: callbackData,
      secret: SECRET,
      nowMs
    });

    expect(result).toMatchObject({
      accepted: true,
      action: 'approve_and_start',
      proposalId: PROPOSAL_ID
    });
  });

  it('rejects payload when signature is missing', () => {
    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve',
      proposalId: PROPOSAL_ID,
      secret: SECRET,
      nowMs: 1_700_000_000_000,
      expiresInSec: 600,
      nonce: 'aa11bb22cc33dd44'
    });
    const unsigned = callbackData.split('|').slice(0, 5).join('|');

    const result = validateTelegramApprovalCallbackData({
      data: unsigned,
      secret: SECRET,
      nowMs: 1_700_000_000_000
    });

    expect(result).toEqual({
      accepted: false,
      reason: 'missing_signature'
    });
  });

  it('rejects payload when signature is invalid', () => {
    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve',
      proposalId: PROPOSAL_ID,
      secret: SECRET,
      nowMs: 1_700_000_000_000,
      expiresInSec: 600,
      nonce: '0011223344556677'
    });
    const tampered = `${callbackData}x`;

    const result = validateTelegramApprovalCallbackData({
      data: tampered,
      secret: SECRET,
      nowMs: 1_700_000_000_000
    });

    expect(result).toEqual({
      accepted: false,
      reason: 'invalid_signature'
    });
  });

  it('rejects expired payload', () => {
    const nowMs = 1_700_000_000_000;
    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve_and_start',
      proposalId: PROPOSAL_ID,
      secret: SECRET,
      nowMs,
      expiresInSec: 1,
      nonce: '0a0b0c0d0e0f1011'
    });

    const result = validateTelegramApprovalCallbackData({
      data: callbackData,
      secret: SECRET,
      nowMs: nowMs + 2_000
    });

    expect(result).toEqual({
      accepted: false,
      reason: 'expired'
    });
  });

  it('rejects replayed nonce when replay guard is enabled', () => {
    const nowMs = 1_700_000_000_000;
    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve',
      proposalId: PROPOSAL_ID,
      secret: SECRET,
      nowMs,
      expiresInSec: 600,
      nonce: 'ffeeddccbbaa9988'
    });
    const replayGuard = createTelegramCallbackReplayGuard();

    const first = validateTelegramApprovalCallbackData({
      data: callbackData,
      secret: SECRET,
      nowMs,
      replayGuard
    });
    const second = validateTelegramApprovalCallbackData({
      data: callbackData,
      secret: SECRET,
      nowMs: nowMs + 1_000,
      replayGuard
    });

    expect(first).toMatchObject({
      accepted: true
    });
    expect(second).toEqual({
      accepted: false,
      reason: 'replayed'
    });
  });
});

