import type { JarvisStore } from '../store/types';
import type { LlmProvider } from '../providers/types';

export type EmbedAndStoreInput = {
  userId: string;
  content: string;
  segmentType: string;
  taskId?: string;
  confidence?: number;
  expiresAt?: string | null;
};

export async function embedAndStore(
  store: JarvisStore,
  embeddingProvider: LlmProvider | null,
  input: EmbedAndStoreInput
): Promise<string> {
  let embedding: number[] | null = null;

  if (embeddingProvider) {
    try {
      const result = await embeddingProvider.generate({
        prompt: input.content,
        taskType: 'chat',
        maxOutputTokens: 1
      });
      if (result.raw && typeof result.raw === 'object' && 'embedding' in result.raw) {
        embedding = result.raw.embedding as number[];
      }
    } catch {
      // Embedding generation is best-effort; store the segment without embedding
    }
  }

  const segment = await store.createMemorySegment({
    userId: input.userId,
    taskId: input.taskId ?? null,
    segmentType: input.segmentType,
    content: input.content,
    embedding,
    confidence: input.confidence ?? 0.5,
    expiresAt: input.expiresAt ?? null
  });

  return segment.id;
}
