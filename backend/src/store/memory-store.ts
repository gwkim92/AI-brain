import { randomUUID } from 'node:crypto';

import { evaluateRadarItems } from '../radar/scoring';
import type {
  ApprovalRecord,
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
  AssistantContextEventRecord,
  AssistantContextRecord,
  AssistantContextStatus,
  AppendAssistantContextEventInput,
  AppendTaskEventInput,
  CouncilRunRecord,
  CreateMissionInput,
  UpdateMissionInput,
  CreateCouncilRunInput,
  CreateExecutionRunInput,
  CreateTaskInput,
  ExecutionRunRecord,
  JarvisStore,
  MemorySegmentRecord,
  MissionRecord,
  MissionStatus,
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  TelegramReportRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  UpdateAssistantContextInput,
  UserRole,
  UpsertAssistantContextInput,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus
} from './types';

export function createMemoryStore(defaultUserId: string, defaultUserEmail = 'jarvis-local@example.com'): JarvisStore {
  const users = new Map<string, AuthUserWithPasswordRecord>();
  const userIdByEmail = new Map<string, string>();
  const sessions = new Map<
    string,
    {
      userId: string;
      tokenHash: string;
      expiresAt: string;
      revokedAt: string | null;
    }
  >();
  const providerCredentials = new Map<
    string,
    {
      encryptedApiKey: string;
      updatedBy: string | null;
      updatedAt: string;
    }
  >();
  const missions = new Map<string, MissionRecord>();
  const assistantContexts = new Map<string, AssistantContextRecord>();
  const assistantContextByClientId = new Map<string, string>();
  const assistantContextEvents = new Map<string, AssistantContextEventRecord[]>();
  let assistantContextEventSequence = 0;

  const tasks = new Map<string, TaskRecord>();
  const taskEvents = new Map<string, TaskEventRecord[]>();

  const radarItems = new Map<string, RadarItemRecord>();
  const radarRecommendations = new Map<string, RadarRecommendationRecord>();
  const telegramReports = new Map<string, TelegramReportRecord>();

  const upgradeProposals = new Map<string, UpgradeProposalRecord>();
  const upgradeRuns = new Map<string, UpgradeRunApiRecord>();
  const councilRuns = new Map<string, CouncilRunRecord>();
  const executionRuns = new Map<string, ExecutionRunRecord>();
  const councilRunByIdempotency = new Map<string, string>();
  const executionRunByIdempotency = new Map<string, string>();
  const memorySegments = new Map<string, MemorySegmentRecord>();
  const approvals = new Map<string, ApprovalRecord>();

  const nowIso = () => new Date().toISOString();

  const toAuthUserRecord = (row: AuthUserWithPasswordRecord): AuthUserRecord => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });

  const store: JarvisStore = {
    kind: 'memory',

    getPool() {
      return null;
    },

    async initialize() {
      const now = nowIso();
      const existingDefault = users.get(defaultUserId);
      if (!existingDefault) {
        const defaultUser: AuthUserWithPasswordRecord = {
          id: defaultUserId,
          email: defaultUserEmail,
          displayName: 'Jarvis Local User',
          role: 'admin',
          passwordHash: null,
          createdAt: now,
          updatedAt: now
        };
        users.set(defaultUser.id, defaultUser);
        userIdByEmail.set(defaultUser.email, defaultUser.id);
      }
      return;
    },

    async health() {
      return {
        store: 'memory',
        db: 'n/a'
      };
    },

    async createAuthUser(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role?: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      if (userIdByEmail.has(email)) {
        return null;
      }

      const now = nowIso();
      const user: AuthUserWithPasswordRecord = {
        id: randomUUID(),
        email,
        displayName: input.displayName?.trim() || null,
        role: input.role ?? 'member',
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now
      };
      users.set(user.id, user);
      userIdByEmail.set(email, user.id);
      return toAuthUserRecord(user);
    },

    async upsertAuthUserByEmail(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      const existingUserId = userIdByEmail.get(email);
      const now = nowIso();

      if (existingUserId) {
        const existing = users.get(existingUserId);
        if (!existing) {
          throw new Error('inconsistent user index state');
        }

        const next: AuthUserWithPasswordRecord = {
          ...existing,
          displayName: input.displayName?.trim() || existing.displayName,
          role: input.role,
          passwordHash: input.passwordHash,
          updatedAt: now
        };
        users.set(existingUserId, next);
        return toAuthUserRecord(next);
      }

      const created: AuthUserWithPasswordRecord = {
        id: randomUUID(),
        email,
        displayName: input.displayName?.trim() || null,
        role: input.role,
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now
      };
      users.set(created.id, created);
      userIdByEmail.set(email, created.id);
      return toAuthUserRecord(created);
    },

    async findAuthUserByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      const userId = userIdByEmail.get(normalized);
      if (!userId) {
        return null;
      }

      const user = users.get(userId);
      return user ?? null;
    },

    async getAuthUserById(userId: string) {
      const user = users.get(userId);
      if (!user) {
        return null;
      }
      return toAuthUserRecord(user);
    },

    async createAuthSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
      sessions.set(input.tokenHash, {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null
      });
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt !== null) {
        return null;
      }

      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        sessions.delete(tokenHash);
        return null;
      }

      const user = users.get(session.userId);
      if (!user) {
        sessions.delete(tokenHash);
        return null;
      }

      return {
        user: toAuthUserRecord(user),
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt
      };
    },

    async revokeAuthSession(tokenHash: string) {
      const session = sessions.get(tokenHash);
      if (!session) {
        return false;
      }

      if (session.revokedAt !== null) {
        return false;
      }

      sessions.set(tokenHash, {
        ...session,
        revokedAt: nowIso()
      });
      return true;
    },

    async listProviderCredentials() {
      return [...providerCredentials.entries()].map(([provider, row]) => ({
        provider: provider as 'openai' | 'gemini' | 'anthropic' | 'local',
        encryptedApiKey: row.encryptedApiKey,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt
      }));
    },

    async upsertProviderCredential(input: {
      provider: 'openai' | 'gemini' | 'anthropic' | 'local';
      encryptedApiKey: string;
      updatedBy?: string | null;
    }) {
      const next = {
        encryptedApiKey: input.encryptedApiKey,
        updatedBy: input.updatedBy ?? null,
        updatedAt: nowIso()
      };
      providerCredentials.set(input.provider, next);
      return {
        provider: input.provider,
        encryptedApiKey: next.encryptedApiKey,
        updatedBy: next.updatedBy,
        updatedAt: next.updatedAt
      };
    },

    async deleteProviderCredential(provider: 'openai' | 'gemini' | 'anthropic' | 'local') {
      return providerCredentials.delete(provider);
    },

    async createMission(input: CreateMissionInput) {
      const now = nowIso();
      const mission: MissionRecord = {
        id: randomUUID(),
        userId: input.userId || defaultUserId,
        workspaceId: input.workspaceId ?? null,
        title: input.title,
        objective: input.objective,
        domain: input.domain,
        status: input.status ?? 'draft',
        steps: input.steps
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((step, index) => ({
            id: step.id || randomUUID(),
            type: step.type,
            title: step.title,
            description: step.description ?? '',
            route: step.route,
            status: step.status ?? 'pending',
            order: index + 1
          })),
        createdAt: now,
        updatedAt: now
      };

      missions.set(mission.id, mission);
      return mission;
    },

    async listMissions(input: { userId: string; status?: MissionStatus; limit: number }) {
      return [...missions.values()]
        .filter((item) => item.userId === input.userId)
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit);
    },

    async getMissionById(input: { missionId: string; userId: string }) {
      const mission = missions.get(input.missionId);
      if (!mission || mission.userId !== input.userId) {
        return null;
      }
      return mission;
    },

    async updateMission(input: UpdateMissionInput) {
      const mission = missions.get(input.missionId);
      if (!mission || mission.userId !== input.userId) {
        return null;
      }

      const stepStatusMap = new Map((input.stepStatuses ?? []).map((item) => [item.stepId, item.status]));
      const nextSteps = mission.steps.map((step) => {
        const nextStatus = stepStatusMap.get(step.id);
        if (!nextStatus) {
          return step;
        }
        return {
          ...step,
          status: nextStatus
        };
      });

      const next: MissionRecord = {
        ...mission,
        status: input.status ?? mission.status,
        title: input.title ?? mission.title,
        objective: input.objective ?? mission.objective,
        steps: nextSteps,
        updatedAt: nowIso()
      };

      missions.set(next.id, next);
      return next;
    },

    async upsertAssistantContext(input: UpsertAssistantContextInput) {
      const now = nowIso();
      const userId = input.userId || defaultUserId;
      const clientContextId = input.clientContextId.trim();
      const mapKey = `${userId}:${clientContextId}`;
      const existingId = assistantContextByClientId.get(mapKey);

      if (existingId) {
        const existing = assistantContexts.get(existingId);
        if (existing) {
          const next: AssistantContextRecord = {
            ...existing,
            taskId: typeof input.taskId === 'string' ? input.taskId : existing.taskId,
            status: input.status ?? existing.status,
            updatedAt: now,
            revision: existing.revision + 1
          };
          assistantContexts.set(next.id, next);
          return next;
        }
      }

      const status: AssistantContextStatus = input.status ?? 'running';
      const next: AssistantContextRecord = {
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

      assistantContexts.set(next.id, next);
      assistantContextByClientId.set(mapKey, next.id);
      return next;
    },

    async updateAssistantContext(input: UpdateAssistantContextInput) {
      const current = assistantContexts.get(input.contextId);
      if (!current || current.userId !== input.userId) {
        return null;
      }

      const next: AssistantContextRecord = {
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

      assistantContexts.set(next.id, next);
      return next;
    },

    async listAssistantContexts(input: { userId: string; status?: AssistantContextStatus; limit: number }) {
      return [...assistantContexts.values()]
        .filter((item) => item.userId === input.userId)
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit);
    },

    async getAssistantContextById(input: { userId: string; contextId: string }) {
      const row = assistantContexts.get(input.contextId);
      if (!row || row.userId !== input.userId) {
        return null;
      }
      return row;
    },

    async getAssistantContextByClientContextId(input: { userId: string; clientContextId: string }) {
      const mapKey = `${input.userId}:${input.clientContextId.trim()}`;
      const contextId = assistantContextByClientId.get(mapKey);
      if (!contextId) {
        return null;
      }
      const row = assistantContexts.get(contextId);
      if (!row || row.userId !== input.userId) {
        return null;
      }
      return row;
    },

    async appendAssistantContextEvent(input: AppendAssistantContextEventInput) {
      const context = assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return null;
      }

      assistantContextEventSequence += 1;
      const next: AssistantContextEventRecord = {
        id: randomUUID(),
        contextId: input.contextId,
        sequence: assistantContextEventSequence,
        eventType: input.eventType,
        data: input.data,
        traceId: input.traceId,
        spanId: input.spanId,
        createdAt: nowIso()
      };

      const prev = assistantContextEvents.get(input.contextId) ?? [];
      prev.push(next);
      assistantContextEvents.set(input.contextId, prev);
      return next;
    },

    async listAssistantContextEvents(input: {
      userId: string;
      contextId: string;
      sinceSequence?: number;
      limit: number;
    }) {
      const context = assistantContexts.get(input.contextId);
      if (!context || context.userId !== input.userId) {
        return [];
      }

      const rows = assistantContextEvents.get(input.contextId) ?? [];
      const sinceSequence = input.sinceSequence;
      const filtered =
        typeof sinceSequence === 'number'
          ? rows.filter((item) => item.sequence > sinceSequence)
          : rows;
      if (filtered.length <= input.limit) {
        return [...filtered];
      }
      return filtered.slice(filtered.length - input.limit);
    },

    async createTask(input: CreateTaskInput) {
      const now = nowIso();
      const task: TaskRecord = {
        id: randomUUID(),
        userId: input.userId || defaultUserId,
        mode: input.mode,
        status: 'queued',
        title: input.title,
        input: input.input,
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        createdAt: now,
        updatedAt: now
      };

      tasks.set(task.id, task);

      await store.appendTaskEvent({
        taskId: task.id,
        type: 'task.created',
        data: {
          mode: task.mode,
          status: task.status
        }
      });

      return task;
    },

    async setTaskStatus(input: {
      taskId: string;
      status: TaskStatus;
      eventType?: string;
      data?: Record<string, unknown>;
      traceId?: string;
      spanId?: string;
    }) {
      const current = tasks.get(input.taskId);
      if (!current) {
        return null;
      }

      const next: TaskRecord = {
        ...current,
        status: input.status,
        updatedAt: nowIso()
      };
      tasks.set(current.id, next);

      await store.appendTaskEvent({
        taskId: current.id,
        type: input.eventType ?? 'task.updated',
        data: {
          status: input.status,
          ...(input.data ?? {})
        },
        traceId: input.traceId,
        spanId: input.spanId
      });

      return next;
    },

    async listTasks(input: { status?: TaskStatus; limit: number }) {
      const rows = [...tasks.values()]
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);

      return rows;
    },

    async getTaskById(taskId: string) {
      return tasks.get(taskId) ?? null;
    },

    async appendTaskEvent(event: AppendTaskEventInput) {
      const next: TaskEventRecord = {
        id: randomUUID(),
        taskId: event.taskId,
        type: event.type,
        timestamp: nowIso(),
        data: event.data,
        traceId: event.traceId,
        spanId: event.spanId
      };

      const prev = taskEvents.get(event.taskId) ?? [];
      prev.push(next);
      taskEvents.set(event.taskId, prev);

      return next;
    },

    async listTaskEvents(taskId: string, limit: number) {
      const rows = taskEvents.get(taskId) ?? [];
      return rows.slice(Math.max(0, rows.length - limit));
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      for (const item of items) {
        radarItems.set(item.id, item);
      }
      return items.length;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      return [...radarItems.values()]
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
        .slice(0, input.limit);
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      const selected = input.itemIds
        .map((itemId) => radarItems.get(itemId))
        .filter((item): item is RadarItemRecord => Boolean(item));

      const candidates = selected.map((item) => ({
        id: item.id,
        title: item.title,
        benefit: Math.max(1.5, Math.min(5, item.confidenceScore * 5)),
        risk: Math.max(0.5, 3.2 - item.confidenceScore * 2),
        cost: 2.5
      }));

      const scored = evaluateRadarItems(candidates);
      const evaluatedAt = nowIso();

      const recommendations: RadarRecommendationRecord[] = scored.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        decision: row.decision,
        totalScore: row.totalScore,
        expectedBenefit: row.expectedBenefit,
        migrationCost: row.migrationCost,
        riskLevel: row.riskLevel,
        evaluatedAt
      }));

      for (const recommendation of recommendations) {
        radarRecommendations.set(recommendation.id, recommendation);

        if (recommendation.decision !== 'discard') {
          const proposalId = randomUUID();
          upgradeProposals.set(proposalId, {
            id: proposalId,
            recommendationId: recommendation.id,
            proposalTitle: `Adopt candidate ${recommendation.itemId}`,
            status: 'proposed',
            createdAt: nowIso(),
            approvedAt: null
          });
        }

        const sourceItem = radarItems.get(recommendation.itemId);
        if (sourceItem) {
          radarItems.set(recommendation.itemId, {
            ...sourceItem,
            status: 'scored'
          });
        }
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      return [...radarRecommendations.values()]
        .filter((item) => (decision ? item.decision === decision : true))
        .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
    },

    async createTelegramReport(input: { chatId: string; topic?: string; bodyMarkdown?: string; maxAttempts?: number }) {
      const now = nowIso();
      const report: TelegramReportRecord = {
        id: randomUUID(),
        chatId: input.chatId,
        topic: input.topic ?? 'radar-digest',
        bodyMarkdown: input.bodyMarkdown ?? '',
        status: 'queued',
        attemptCount: 0,
        maxAttempts: Math.max(1, input.maxAttempts ?? 3),
        nextAttemptAt: now,
        lastError: null,
        telegramMessageId: null,
        sentAt: null,
        createdAt: now
      };
      telegramReports.set(report.id, report);
      return report;
    },

    async listTelegramReports(input: { status?: TelegramReportRecord['status']; limit: number }) {
      return [...telegramReports.values()]
        .filter((report) => (input.status ? report.status === input.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);
    },

    async getTelegramReportById(reportId: string) {
      return telegramReports.get(reportId) ?? null;
    },

    async listPendingTelegramReports(input: { limit: number; nowIso?: string }) {
      const now = input.nowIso ?? nowIso();
      return [...telegramReports.values()]
        .filter((report) => report.status === 'queued')
        .filter((report) => report.attemptCount < report.maxAttempts)
        .filter((report) => !report.nextAttemptAt || report.nextAttemptAt <= now)
        .sort((left, right) => {
          const leftKey = left.nextAttemptAt ?? left.createdAt;
          const rightKey = right.nextAttemptAt ?? right.createdAt;
          if (leftKey === rightKey) {
            return left.createdAt.localeCompare(right.createdAt);
          }
          return leftKey.localeCompare(rightKey);
        })
        .slice(0, input.limit);
    },

    async updateTelegramReportDelivery(input: {
      reportId: string;
      status: 'queued' | 'sent' | 'failed';
      incrementAttemptCount?: boolean;
      attemptCount?: number;
      maxAttempts?: number;
      telegramMessageId?: string | null;
      sentAt?: string | null;
      nextAttemptAt?: string | null;
      lastError?: string | null;
      bodyMarkdown?: string;
    }) {
      const current = telegramReports.get(input.reportId);
      if (!current) {
        return null;
      }

      const next: TelegramReportRecord = {
        ...current,
        status: input.status,
        attemptCount: input.attemptCount ?? current.attemptCount + (input.incrementAttemptCount ? 1 : 0),
        maxAttempts: input.maxAttempts ?? current.maxAttempts,
        bodyMarkdown: input.bodyMarkdown ?? current.bodyMarkdown,
        nextAttemptAt: input.nextAttemptAt === undefined ? current.nextAttemptAt : input.nextAttemptAt,
        lastError: input.lastError === undefined ? current.lastError : input.lastError,
        telegramMessageId: input.telegramMessageId === undefined ? current.telegramMessageId ?? null : input.telegramMessageId,
        sentAt:
          input.sentAt === undefined ? (input.status === 'sent' ? nowIso() : current.sentAt ?? null) : input.sentAt
      };
      telegramReports.set(next.id, next);
      return next;
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      return [...upgradeProposals.values()]
        .filter((item) => (status ? item.status === status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async findUpgradeProposalById(proposalId: string) {
      return upgradeProposals.get(proposalId) ?? null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject') {
      const current = upgradeProposals.get(proposalId);
      if (!current) {
        return null;
      }

      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';
      const next: UpgradeProposalRecord = {
        ...current,
        status: nextStatus,
        approvedAt: nextStatus === 'approved' ? nowIso() : null
      };
      upgradeProposals.set(proposalId, next);

      return next;
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const now = nowIso();
      const run: UpgradeRunApiRecord = {
        id: randomUUID(),
        proposalId: payload.proposalId,
        status: 'planning',
        startCommand: payload.startCommand,
        createdAt: now,
        updatedAt: now
      };
      upgradeRuns.set(run.id, run);
      return run;
    },

    async listUpgradeRuns(limit: number) {
      return [...upgradeRuns.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },

    async getUpgradeRunById(runId: string) {
      return upgradeRuns.get(runId) ?? null;
    },

    async createCouncilRun(input: CreateCouncilRunInput) {
      const now = nowIso();
      const run: CouncilRunRecord = {
        id: randomUUID(),
        question: input.question,
        status: input.status,
        consensus_status: input.consensus_status,
        summary: input.summary,
        participants: input.participants,
        attempts: input.attempts,
        provider: input.provider,
        model: input.model,
        used_fallback: input.used_fallback,
        task_id: input.task_id,
        created_at: now,
        updated_at: now
      };
      councilRuns.set(run.id, run);
      councilRunByIdempotency.set(`${input.user_id}:${input.idempotency_key}`, run.id);
      return run;
    },

    async updateCouncilRun(input) {
      const current = councilRuns.get(input.runId);
      if (!current) {
        return null;
      }

      const next: CouncilRunRecord = {
        ...current,
        status: input.status ?? current.status,
        consensus_status: input.consensus_status ?? current.consensus_status,
        summary: input.summary ?? current.summary,
        participants: input.participants ?? current.participants,
        attempts: input.attempts ?? current.attempts,
        provider: input.provider === undefined ? current.provider : input.provider,
        model: input.model ?? current.model,
        used_fallback: input.used_fallback ?? current.used_fallback,
        task_id: input.task_id === undefined ? current.task_id : input.task_id,
        updated_at: nowIso()
      };

      councilRuns.set(current.id, next);
      return next;
    },

    async getCouncilRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const runId = councilRunByIdempotency.get(`${input.userId}:${input.idempotencyKey}`);
      return runId ? (councilRuns.get(runId) ?? null) : null;
    },

    async listCouncilRuns(limit: number) {
      return [...councilRuns.values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, limit);
    },

    async getCouncilRunById(runId: string) {
      return councilRuns.get(runId) ?? null;
    },

    async createExecutionRun(input: CreateExecutionRunInput) {
      const now = nowIso();
      const run: ExecutionRunRecord = {
        id: randomUUID(),
        mode: input.mode,
        prompt: input.prompt,
        status: input.status,
        output: input.output,
        attempts: input.attempts,
        provider: input.provider,
        model: input.model,
        used_fallback: input.used_fallback,
        task_id: input.task_id,
        duration_ms: input.duration_ms,
        created_at: now,
        updated_at: now
      };
      executionRuns.set(run.id, run);
      executionRunByIdempotency.set(`${input.user_id}:${input.idempotency_key}`, run.id);
      return run;
    },

    async updateExecutionRun(input) {
      const current = executionRuns.get(input.runId);
      if (!current) {
        return null;
      }

      const next: ExecutionRunRecord = {
        ...current,
        status: input.status ?? current.status,
        output: input.output ?? current.output,
        attempts: input.attempts ?? current.attempts,
        provider: input.provider === undefined ? current.provider : input.provider,
        model: input.model ?? current.model,
        used_fallback: input.used_fallback ?? current.used_fallback,
        task_id: input.task_id === undefined ? current.task_id : input.task_id,
        duration_ms: input.duration_ms ?? current.duration_ms,
        updated_at: nowIso()
      };

      executionRuns.set(current.id, next);
      return next;
    },

    async getExecutionRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const runId = executionRunByIdempotency.get(`${input.userId}:${input.idempotencyKey}`);
      return runId ? (executionRuns.get(runId) ?? null) : null;
    },

    async listExecutionRuns(limit: number) {
      return [...executionRuns.values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, limit);
    },

    async getExecutionRunById(runId: string) {
      return executionRuns.get(runId) ?? null;
    },

    async createMemorySegment(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const record: MemorySegmentRecord = {
        id,
        userId: input.userId,
        taskId: input.taskId ?? null,
        segmentType: input.segmentType,
        content: input.content,
        confidence: input.confidence ?? 0.5,
        createdAt: now,
        expiresAt: input.expiresAt ?? null
      };
      memorySegments.set(id, record);
      return record;
    },

    async searchMemoryByEmbedding(input) {
      const minConf = input.minConfidence ?? 0;
      return Array.from(memorySegments.values())
        .filter((s) => s.userId === input.userId && s.confidence >= minConf)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, input.limit);
    },

    async listMemorySegments(input) {
      return Array.from(memorySegments.values())
        .filter((s) => s.userId === input.userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, input.limit);
    },

    async createApproval(input) {
      const id = randomUUID();
      const now = nowIso();
      const record: ApprovalRecord = {
        id,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        status: 'pending',
        requestedBy: input.requestedBy ?? null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
        expiresAt: input.expiresAt ?? null,
        createdAt: now
      };
      approvals.set(id, record);
      return record;
    },

    async listApprovals(input) {
      return Array.from(approvals.values())
        .filter((a) => !input.status || a.status === input.status)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, input.limit);
    },

    async decideApproval(input) {
      const approval = approvals.get(input.approvalId);
      if (!approval || approval.status !== 'pending') return null;

      const updated: ApprovalRecord = {
        ...approval,
        status: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: nowIso(),
        reason: input.reason ?? null
      };
      approvals.set(input.approvalId, updated);
      return updated;
    },

    createUpgradeExecutorGateway() {
      return {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) {
            return null;
          }
          return {
            id: proposal.id,
            status: proposal.status,
            approvedAt: proposal.approvedAt
          };
        },
        createRun: async (payload: { proposalId: string; startCommand: string }) => {
          const run = await store.createUpgradeRun(payload);
          return {
            id: run.id,
            proposalId: run.proposalId,
            status: run.status
          };
        },
        appendAuditLog: async () => {
          return;
        }
      };
    }
  };

  return store;
}
