import { randomUUID } from 'node:crypto';

import type {
  AppendAssistantContextEventInput,
  AssistantContextEventRecord,
  AssistantContextGroundingClaimRecord,
  AssistantContextGroundingSourceRecord,
  AssistantContextStatus,
  ReplaceAssistantContextGroundingClaimsInput,
  ReplaceAssistantContextGroundingSourcesInput,
  UpdateAssistantContextInput,
  UpsertAssistantContextInput
} from '../types';
import type { AssistantContextRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryAssistantContextRepositoryDeps = {
  state: MemoryStoreState;
  defaultUserId: string;
  nowIso: () => string;
};

export function createMemoryAssistantContextRepository({
  state,
  defaultUserId,
  nowIso
}: MemoryAssistantContextRepositoryDeps): AssistantContextRepositoryContract {
  return {
    async upsertAssistantContext(input: UpsertAssistantContextInput) {
      const now = nowIso();
      const userId = input.userId || defaultUserId;
      const clientContextId = input.clientContextId.trim();
      const mapKey = `${userId}:${clientContextId}`;
      const existingId = state.assistantContextByClientId.get(mapKey);

      if (existingId) {
        const existing = state.assistantContexts.get(existingId);
        if (existing) {
          const next = {
            ...existing,
            taskId: typeof input.taskId === 'string' ? input.taskId : existing.taskId,
            status: input.status ?? existing.status,
            updatedAt: now,
            revision: existing.revision + 1
          };
          state.assistantContexts.set(next.id, next);
          return next;
        }
      }

      const status: AssistantContextStatus = input.status ?? 'running';
      const next = {
        id: randomUUID(),
        userId,
        clientContextId,
        source: input.source.trim() || 'inbox_quick_command',
        intent: input.intent.trim() || 'general',
        prompt: input.prompt,
        widgetPlan: input.widgetPlan.filter((item) => typeof item === 'string' && item.trim().length > 0),
        status,
        taskId: input.taskId ?? null,
        servedProvider: null,
        servedModel: null,
        usedFallback: false,
        selectionReason: null,
        output: '',
        error: null,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };

      state.assistantContexts.set(next.id, next);
      state.assistantContextByClientId.set(mapKey, next.id);
      return next;
    },

    async updateAssistantContext(input: UpdateAssistantContextInput) {
      const current = state.assistantContexts.get(input.contextId);
      if (!current || current.userId !== input.userId) {
        return null;
      }

      const next = {
        ...current,
        status: input.status ?? current.status,
        taskId: typeof input.taskId === 'undefined' ? current.taskId : input.taskId,
        servedProvider: typeof input.servedProvider === 'undefined' ? current.servedProvider : input.servedProvider,
        servedModel: typeof input.servedModel === 'undefined' ? current.servedModel : input.servedModel,
        usedFallback: typeof input.usedFallback === 'undefined' ? current.usedFallback : input.usedFallback,
        selectionReason:
          typeof input.selectionReason === 'undefined' ? current.selectionReason : input.selectionReason,
        output: typeof input.output === 'undefined' ? current.output : input.output,
        error: typeof input.error === 'undefined' ? current.error : input.error,
        updatedAt: nowIso(),
        revision: current.revision + 1
      };

      state.assistantContexts.set(next.id, next);
      return next;
    },

    async listAssistantContexts(input: { userId: string; status?: AssistantContextStatus; limit: number }) {
      return [...state.assistantContexts.values()]
        .filter((item) => item.userId === input.userId)
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit);
    },

    async getAssistantContextById(input: { userId: string; contextId: string }) {
      const row = state.assistantContexts.get(input.contextId);
      if (!row || row.userId !== input.userId) {
        return null;
      }
      return row;
    },

    async getAssistantContextByClientContextId(input: { userId: string; clientContextId: string }) {
      const mapKey = `${input.userId}:${input.clientContextId.trim()}`;
      const contextId = state.assistantContextByClientId.get(mapKey);
      if (!contextId) {
        return null;
      }
      const row = state.assistantContexts.get(contextId);
      if (!row || row.userId !== input.userId) {
        return null;
      }
      return row;
    },

    async appendAssistantContextEvent(input: AppendAssistantContextEventInput) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return null;
      }

      state.assistantContextEventSequence += 1;
      const next: AssistantContextEventRecord = {
        id: randomUUID(),
        contextId: input.contextId,
        sequence: state.assistantContextEventSequence,
        eventType: input.eventType,
        data: input.data,
        traceId: input.traceId,
        spanId: input.spanId,
        createdAt: nowIso()
      };

      const prev = state.assistantContextEvents.get(input.contextId) ?? [];
      prev.push(next);
      state.assistantContextEvents.set(input.contextId, prev);
      return next;
    },

    async listAssistantContextEvents(input: {
      userId: string;
      contextId: string;
      sinceSequence?: number;
      limit: number;
    }) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const rows = state.assistantContextEvents.get(input.contextId) ?? [];
      const sinceSequence = input.sinceSequence;
      const filtered = typeof sinceSequence === 'number' ? rows.filter((item) => item.sequence > sinceSequence) : rows;
      if (filtered.length <= input.limit) {
        return [...filtered];
      }
      return filtered.slice(filtered.length - input.limit);
    },

    async replaceAssistantContextGroundingSources(input: ReplaceAssistantContextGroundingSourcesInput) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const now = nowIso();
      const next = input.sources
        .map((source, index) => {
          const url = source.url.trim();
          if (!url) {
            return null;
          }
          const title = source.title.trim();
          const domain = source.domain.trim();
          return {
            id: randomUUID(),
            contextId: input.contextId,
            url,
            title: title.length > 0 ? title : domain || 'source',
            domain: domain.length > 0 ? domain : 'unknown',
            sourceOrder: index,
            createdAt: now
          } as AssistantContextGroundingSourceRecord;
        })
        .filter((item): item is AssistantContextGroundingSourceRecord => item !== null);

      state.assistantContextGroundingSources.set(input.contextId, next);
      state.assistantContextGroundingClaims.delete(input.contextId);
      return [...next];
    },

    async listAssistantContextGroundingSources(input: { userId: string; contextId: string; limit: number }) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const rows = state.assistantContextGroundingSources.get(input.contextId) ?? [];
      if (rows.length <= input.limit) {
        return [...rows];
      }
      return rows.slice(0, input.limit);
    },

    async replaceAssistantContextGroundingClaims(input: ReplaceAssistantContextGroundingClaimsInput) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const sourceRows = state.assistantContextGroundingSources.get(input.contextId) ?? [];
      const sourceByUrl = new Map(sourceRows.map((source) => [source.url, source]));
      const now = nowIso();
      const next = input.claims
        .map((claim, claimIndex) => {
          const claimText = claim.claimText.trim();
          if (!claimText) {
            return null;
          }

          const seenUrls = new Set<string>();
          const citations = claim.sourceUrls
            .map((url) => url.trim())
            .filter((url) => {
              if (!url || seenUrls.has(url)) {
                return false;
              }
              seenUrls.add(url);
              return true;
            })
            .map((url, citationIndex) => {
              const source = sourceByUrl.get(url);
              if (!source) {
                return null;
              }
              return {
                sourceId: source.id,
                url: source.url,
                title: source.title,
                domain: source.domain,
                citationOrder: citationIndex,
                sourceOrder: source.sourceOrder
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          if (citations.length === 0) {
            return null;
          }

          return {
            id: randomUUID(),
            contextId: input.contextId,
            claimText,
            claimOrder: claimIndex,
            citations,
            createdAt: now
          } as AssistantContextGroundingClaimRecord;
        })
        .filter((item): item is AssistantContextGroundingClaimRecord => item !== null);

      state.assistantContextGroundingClaims.set(input.contextId, next);
      return [...next];
    },

    async listAssistantContextGroundingClaims(input: { userId: string; contextId: string; limit: number }) {
      const context = state.assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const rows = state.assistantContextGroundingClaims.get(input.contextId) ?? [];
      if (rows.length <= input.limit) {
        return [...rows];
      }
      return rows.slice(0, input.limit);
    }
  };
}
