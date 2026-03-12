import { describe, expect, it } from 'vitest';

import {
  buildResponseInstructionWithMemory,
  resolveMemoryBackedRouting,
  type JarvisMemoryPlan,
  type JarvisMemoryPreferenceHints
} from '../memory-context';

describe('buildResponseInstructionWithMemory', () => {
  it('emits concise guidance when concise preference exists', () => {
    const preferences: JarvisMemoryPreferenceHints = {
      responseStyle: 'concise',
      preferredProvider: null,
      preferredModel: null,
      riskTolerance: null,
      approvalStyle: null,
      monitoringPreference: null,
      preferMonitorAfterBrief: false,
      preferNotifyAfterMonitor: false,
      summary: []
    };

    const instruction = buildResponseInstructionWithMemory({
      preferences,
      memoryPlan: null,
      expectedLanguage: 'ko'
    });

    expect(instruction).toContain('핵심만 짧게');
  });

  it('emits detailed guidance when detailed preference exists', () => {
    const preferences: JarvisMemoryPreferenceHints = {
      responseStyle: 'detailed',
      preferredProvider: null,
      preferredModel: null,
      riskTolerance: null,
      approvalStyle: null,
      monitoringPreference: null,
      preferMonitorAfterBrief: false,
      preferNotifyAfterMonitor: false,
      summary: []
    };

    const instruction = buildResponseInstructionWithMemory({
      preferences,
      memoryPlan: null,
      expectedLanguage: 'en'
    });

    expect(instruction).toContain('Prefer a detailed response');
  });

  it('surfaces risk and approval guidance before execution detail when memory signals require it', () => {
    const memoryPlan: JarvisMemoryPlan = {
      signals: ['risk_first_preference', 'approval_sensitive_preference', 'recent_rejection_history'],
      summary: []
    };

    const instruction = buildResponseInstructionWithMemory({
      preferences: null,
      memoryPlan,
      expectedLanguage: 'ko'
    });

    expect(instruction).toContain('리스크와 승인 포인트');
    expect(instruction).toContain('보수적인 대안');
  });

  it('returns an empty instruction when no response-affecting preferences exist', () => {
    const instruction = buildResponseInstructionWithMemory({
      preferences: null,
      memoryPlan: null,
      expectedLanguage: 'en'
    });

    expect(instruction).toBe('');
  });

  it('uses preferred provider and model as routing defaults when the request is unset', () => {
    const preferences: JarvisMemoryPreferenceHints = {
      responseStyle: null,
      preferredProvider: 'openai',
      preferredModel: 'gpt-5-mini',
      riskTolerance: null,
      approvalStyle: null,
      monitoringPreference: null,
      preferMonitorAfterBrief: false,
      preferNotifyAfterMonitor: false,
      summary: []
    };

    const routing = resolveMemoryBackedRouting({
      provider: undefined,
      strictProvider: undefined,
      model: undefined,
      memoryPreferences: preferences
    });

    expect(routing.provider).toBe('openai');
    expect(routing.strictProvider).toBe(true);
    expect(routing.model).toBe('gpt-5-mini');
    expect(routing.applied).toEqual(['preferred_provider:openai', 'preferred_model:gpt-5-mini']);
  });
});
