import { describe, expect, it } from 'vitest';

import { mapResearchProfileToJarvisIntent, resolveResearchProfile, shouldRouteByResearchProfile } from '../research-profile';

describe('resolveResearchProfile', () => {
  it('routes broad and topic news deterministically', () => {
    const broad = resolveResearchProfile({
      prompt: '오늘 주요 뉴스를 정리해줘',
      intent: 'general'
    });
    expect(broad.profile).toBe('broad_news');
    expect(shouldRouteByResearchProfile(broad)).toBe(true);
    expect(mapResearchProfileToJarvisIntent(broad.profile)).toBe('news');

    const topic = resolveResearchProfile({
      prompt: '우크라이나 전쟁 최신 동향을 정리해줘',
      intent: 'general'
    });
    expect(topic.profile).toBe('topic_news');
    expect(shouldRouteByResearchProfile(topic)).toBe(true);
  });

  it('routes entity brief prompts with named subjects', () => {
    const entity = resolveResearchProfile({
      prompt: 'TSMC를 요약해줘',
      intent: 'general'
    });
    expect(entity.profile).toBe('entity_brief');
    expect(entity.reasons).toContain('entity_named_subject_signal');
    expect(shouldRouteByResearchProfile(entity)).toBe(true);
    expect(mapResearchProfileToJarvisIntent(entity.profile)).toBe('research');
  });

  it('routes policy prompts with explicit act/regulation terms', () => {
    const policy = resolveResearchProfile({
      prompt: 'EU AI Act 최근 변화를 정리해줘',
      intent: 'general'
    });
    expect(policy.profile).toBe('policy_regulation');
    expect(policy.reasons).toContain('policy_signal');
    expect(shouldRouteByResearchProfile(policy)).toBe(true);
  });

  it('does not force generic summary prompts into research routing', () => {
    const generic = resolveResearchProfile({
      prompt: '지금 시스템 상태를 한 줄로 요약해줘',
      intent: 'general'
    });
    expect(generic.profile).toBe('entity_brief');
    expect(generic.reasons).toContain('default_profile_fallback');
    expect(shouldRouteByResearchProfile(generic)).toBe(false);
  });
});
