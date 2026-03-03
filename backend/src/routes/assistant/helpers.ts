import type { RouteContext } from '../types';

export async function resolveTaskIdForContext(
  store: RouteContext['store'],
  userId: string,
  clientContextId: string
): Promise<string | null> {
  const tasks = await store.listTasks({ userId, status: undefined, limit: 400 });
  const sorted = [...tasks].sort((left, right) => {
    const leftTs = Date.parse(left.createdAt);
    const rightTs = Date.parse(right.createdAt);
    const safeLeftTs = Number.isNaN(leftTs) ? 0 : leftTs;
    const safeRightTs = Number.isNaN(rightTs) ? 0 : rightTs;
    return safeRightTs - safeLeftTs;
  });

  const matched = sorted.find((task) => {
    if (task.userId !== userId) {
      return false;
    }
    const missionIntakeId = typeof task.input?.mission_intake_id === 'string' ? task.input.mission_intake_id : null;
    if (missionIntakeId === clientContextId) {
      return true;
    }
    const clientContextFromTask = typeof task.input?.client_context_id === 'string' ? task.input.client_context_id : null;
    if (clientContextFromTask === clientContextId) {
      return true;
    }
    return false;
  });

  return matched?.id ?? null;
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
