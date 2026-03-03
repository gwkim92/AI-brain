import type { RouteContext } from '../types';

export async function resolveTaskIdForContext(
  store: RouteContext['store'],
  userId: string,
  clientContextId: string
): Promise<string | null> {
  const tasks = await store.listTasks({ userId, status: undefined, limit: 200 });
  for (const task of tasks) {
    if (task.userId !== userId) {
      continue;
    }
    const missionIntakeId = typeof task.input?.mission_intake_id === 'string' ? task.input.mission_intake_id : null;
    if (missionIntakeId === clientContextId) {
      return task.id;
    }
  }
  return null;
}

export function hasTemplateArtifact(output: string): boolean {
  return /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/u.test(output);
}

export function buildRadarQualityFallbackMessage(): string {
  return [
    '근거 기반 응답 품질 검증에 실패했습니다.',
    '현재 응답에는 템플릿 토큰/근거 정책 위반이 감지되어 신뢰 가능한 결과로 제공할 수 없습니다.',
    '권장 조치: 외부 grounding provider(OpenAI/Gemini/Anthropic) API 키를 연결하고 다시 요청하세요.'
  ].join('\n');
}
