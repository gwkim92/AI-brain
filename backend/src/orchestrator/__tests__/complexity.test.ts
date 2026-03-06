import { describe, expect, it } from 'vitest';

import { classifyComplexity, buildSimplePlan } from '../complexity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe('classifyComplexity', () => {
  it('classifies empty or short prompts as simple', () => {
    expect(classifyComplexity('')).toBe('simple');
    expect(classifyComplexity('hello')).toBe('simple');
    expect(classifyComplexity('fix the bug')).toBe('simple');
  });

  it('classifies single-domain short prompts as simple', () => {
    expect(classifyComplexity('Write a Python function that adds two numbers')).toBe('simple');
  });

  it('classifies multi-step keywords as moderate or higher', () => {
    expect(classifyComplexity('First analyze the data then write a report')).not.toBe('simple');
  });

  it('classifies enumerated lists as moderate or complex', () => {
    const prompt = `
      1. Analyze the codebase
      2. Write unit tests
      3. Refactor the main module
      4. Deploy to production
    `;
    const result = classifyComplexity(prompt);
    expect(['moderate', 'complex']).toContain(result);
  });

  it('classifies multi-domain prompts as moderate or complex', () => {
    const prompt = 'Research the latest AI papers and write code to implement the key algorithm, then analyze the financial impact';
    const result = classifyComplexity(prompt);
    expect(['moderate', 'complex']).toContain(result);
  });

  it('classifies Korean multi-step prompts', () => {
    const prompt = '먼저 코드를 분석하고, 그 다음 리서치를 진행하고, 데이터를 통계적으로 분석해라';
    const result = classifyComplexity(prompt);
    expect(result).not.toBe('simple');
  });

  it('classifies very long prompts as moderate or complex', () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const result = classifyComplexity(words);
    expect(['moderate', 'complex']).toContain(result);
  });
});

describe('buildSimplePlan', () => {
  it('produces a single llm_generate step', () => {
    const plan = buildSimplePlan('Do something');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.type).toBe('llm_generate');
    expect(plan.steps[0]!.taskType).toBe('execute');
    expect(plan.steps[0]!.description).toBe('Do something');
  });

  it('truncates title to 80 chars', () => {
    const longPrompt = 'A'.repeat(200);
    const plan = buildSimplePlan(longPrompt);
    expect(plan.title.length).toBeLessThanOrEqual(80);
  });

  it('emits UUID step id for persistence-safe mission creation', () => {
    const plan = buildSimplePlan('Do something');
    expect(plan.steps[0]?.id).toMatch(UUID_PATTERN);
  });
});
