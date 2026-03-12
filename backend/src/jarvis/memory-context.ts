import type { ProviderName } from '../providers/types';
import type {
  JarvisStore,
  MemoryNoteRecord,
  MemoryPreferenceApprovalStyle,
  MemoryPreferenceMonitoring,
  MemoryPreferenceResponseStyle,
  MemoryPreferenceRiskTolerance,
} from '../store/types';

export type JarvisMemoryContextNote = Pick<
  MemoryNoteRecord,
  | 'id'
  | 'kind'
  | 'title'
  | 'content'
  | 'key'
  | 'value'
  | 'attributes'
  | 'tags'
  | 'pinned'
  | 'source'
  | 'relatedSessionId'
  | 'relatedTaskId'
  | 'updatedAt'
>;

export type JarvisProjectContext = {
  repoSlug: string | null;
  projectName: string | null;
  goalSummary: string | null;
  pinnedRefs: string[];
  noteIds: string[];
  summary: string[];
};

export type JarvisRecentDecisionSignals = {
  recentApprovalHistory: boolean;
  recentRejectionHistory: boolean;
  approvalSensitivePreference: boolean;
  safeAutoRunAcceptance: boolean;
  summary: string[];
};

export type JarvisMemoryPreferenceHints = {
  responseStyle: MemoryPreferenceResponseStyle | null;
  preferredProvider: ProviderName | null;
  preferredModel: string | null;
  riskTolerance: MemoryPreferenceRiskTolerance | null;
  approvalStyle: MemoryPreferenceApprovalStyle | null;
  monitoringPreference: MemoryPreferenceMonitoring | null;
  preferMonitorAfterBrief: boolean;
  preferNotifyAfterMonitor: boolean;
  summary: string[];
};

export type JarvisMemoryContext = {
  notes: JarvisMemoryContextNote[];
  structuredNotes: JarvisMemoryContextNote[];
  summary: string[];
  appliedHints: string[];
  preferences: JarvisMemoryPreferenceHints | null;
  projectContext: JarvisProjectContext | null;
  recentDecisionSignals: JarvisRecentDecisionSignals;
};

export type JarvisMemoryPlanSignal =
  | 'pinned_context'
  | 'project_context_available'
  | 'research_history_available'
  | 'recent_approval_history'
  | 'recent_rejection_history'
  | 'risk_first_preference'
  | 'approval_sensitive_preference'
  | 'monitor_followup_preference'
  | 'notify_followup_preference'
  | 'manual_monitoring_preference'
  | 'all_changes_monitoring_preference'
  | 'concise_response_preference'
  | 'balanced_response_preference'
  | 'detailed_response_preference'
  | 'preferred_provider_available'
  | 'preferred_model_available'
  | 'cautious_risk_preference'
  | 'aggressive_risk_preference'
  | 'read_only_review_preference'
  | 'safe_auto_run_preference';

export type JarvisMemoryPlan = {
  signals: JarvisMemoryPlanSignal[];
  summary: string[];
};

const MODEL_HINT_PATTERN = /\b(gpt-[a-z0-9.-]+|o[1345](?:-[a-z0-9.-]+)?|gemini-[a-z0-9.-]+|claude-[a-z0-9.-]+|llama-[a-z0-9.-]+|qwen-[a-z0-9.-]+)\b/iu;
const REPO_SLUG_PATTERN = /\b([a-z0-9_.-]+\/[a-z0-9_.-]+)\b/iu;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function inferProviderFromModel(model: string): ProviderName | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4') ||
    normalized.startsWith('o5')
  ) {
    return 'openai';
  }
  if (normalized.startsWith('gemini-')) {
    return 'gemini';
  }
  if (normalized.startsWith('claude-')) {
    return 'anthropic';
  }
  if (normalized.startsWith('llama-') || normalized.startsWith('qwen-')) {
    return 'local';
  }
  return null;
}

function scoreNote(promptTokens: string[], note: MemoryNoteRecord): number {
  const titleTokens = tokenize(note.title);
  const contentTokens = tokenize(note.content);
  const tagTokens = note.tags.map((tag) => tag.toLowerCase());
  const keyTokens = note.key ? tokenize(note.key) : [];
  const valueTokens = note.value ? tokenize(note.value) : [];
  const tokenSet = new Set([...titleTokens, ...contentTokens, ...tagTokens, ...keyTokens, ...valueTokens]);
  const overlaps = promptTokens.filter((token) => tokenSet.has(token)).length;
  const pinnedBoost = note.pinned ? 8 : 0;
  const kindBoost =
    note.kind === 'project_context'
      ? 4
      : note.kind === 'user_preference'
        ? 3
        : note.kind === 'decision_memory'
          ? 2
          : 1;
  const recentBoost = Math.max(0, 2 - Math.floor((Date.now() - Date.parse(note.updatedAt)) / 86_400_000));
  return overlaps * 5 + pinnedBoost + kindBoost + recentBoost;
}

function buildSummary(notes: MemoryNoteRecord[], preferences: JarvisMemoryPreferenceHints | null, projectContext: JarvisProjectContext | null): string[] {
  const lines: string[] = [];
  const pinned = notes.filter((note) => note.pinned).length;
  const decisions = notes.filter((note) => note.kind === 'decision_memory').length;
  const preferenceNotes = notes.filter((note) => note.kind === 'user_preference').length;
  if (pinned > 0) lines.push(`${pinned} pinned context note(s) applied`);
  if (preferenceNotes > 0) lines.push(`${preferenceNotes} preference note(s) considered`);
  if (decisions > 0) lines.push(`${decisions} recent decision note(s) referenced`);
  if (preferences?.summary.length) lines.push(...preferences.summary);
  if (projectContext?.summary.length) lines.push(...projectContext.summary);
  return Array.from(new Set(lines));
}

function buildAppliedHints(notes: MemoryNoteRecord[], preferences: JarvisMemoryPreferenceHints | null, projectContext: JarvisProjectContext | null): string[] {
  const hints = new Set<string>();
  for (const note of notes) {
    if (note.pinned) hints.add('pinned_context');
    if (note.kind === 'user_preference') hints.add('user_preference');
    if (note.kind === 'decision_memory') hints.add('recent_decision');
    if (note.kind === 'project_context') hints.add('project_context');
    if (note.key) hints.add(`memory_key:${note.key}`);
  }
  if (preferences?.preferredProvider) hints.add(`preferred_provider:${preferences.preferredProvider}`);
  if (preferences?.preferredModel) hints.add(`preferred_model:${preferences.preferredModel}`);
  if (preferences?.approvalStyle) hints.add(`approval_style:${preferences.approvalStyle}`);
  if (preferences?.monitoringPreference) hints.add(`monitoring:${preferences.monitoringPreference}`);
  if (projectContext?.repoSlug) hints.add(`project_repo:${projectContext.repoSlug}`);
  return [...hints];
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item): item is string => Boolean(item));
}

function parseResponseStyle(value: unknown): MemoryPreferenceResponseStyle | null {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === 'concise' || normalized === 'balanced' || normalized === 'detailed') {
    return normalized;
  }
  return null;
}

function parseProvider(value: unknown): ProviderName | null {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === 'openai' || normalized === 'gemini' || normalized === 'anthropic' || normalized === 'local') {
    return normalized;
  }
  return null;
}

function parseRiskTolerance(value: unknown): MemoryPreferenceRiskTolerance | null {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === 'cautious' || normalized === 'balanced' || normalized === 'aggressive') {
    return normalized;
  }
  return null;
}

function parseApprovalStyle(value: unknown): MemoryPreferenceApprovalStyle | null {
  const normalized = asString(value)?.toLowerCase();
  if (
    normalized === 'read_only_review' ||
    normalized === 'approval_required_write' ||
    normalized === 'safe_auto_run_preferred'
  ) {
    return normalized;
  }
  return null;
}

function parseMonitoringPreference(value: unknown): MemoryPreferenceMonitoring | null {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === 'manual' || normalized === 'important_changes' || normalized === 'all_changes') {
    return normalized;
  }
  return null;
}

function inferResponseStyleFromText(haystack: string): MemoryPreferenceResponseStyle | null {
  if (/(짧게|간결|핵심만|concise|brief only|short answer)/iu.test(haystack)) return 'concise';
  if (/(자세히|상세|깊게|thorough|detailed|full detail)/iu.test(haystack)) return 'detailed';
  if (/(균형|보통|balanced|default)/iu.test(haystack)) return 'balanced';
  return null;
}

function inferRiskToleranceFromText(haystack: string): MemoryPreferenceRiskTolerance | null {
  if (/(보수적|신중|cautious|conservative|리스크.*먼저|risk.*first)/iu.test(haystack)) return 'cautious';
  if (/(공격적|aggressive|빠르게 실행|execute fast)/iu.test(haystack)) return 'aggressive';
  if (/(균형|balanced|standard)/iu.test(haystack)) return 'balanced';
  return null;
}

function inferApprovalStyleFromText(haystack: string): MemoryPreferenceApprovalStyle | null {
  if (/(읽기 전용|read.?only|먼저 점검|review first)/iu.test(haystack)) return 'read_only_review';
  if (/(안전 자동 실행|safe auto|자동 실행 선호)/iu.test(haystack)) return 'safe_auto_run_preferred';
  if (/(승인|approval|required write|검토 필요|high.?risk|고위험)/iu.test(haystack)) return 'approval_required_write';
  return null;
}

function inferMonitoringPreferenceFromText(haystack: string): MemoryPreferenceMonitoring | null {
  if (/(수동|manual only|직접 볼 때만)/iu.test(haystack)) return 'manual';
  if (/(모든 변화|all changes|사소한 변화도)/iu.test(haystack)) return 'all_changes';
  if (/(중요 변화|important changes|변화가 크면|알려줘)/iu.test(haystack)) return 'important_changes';
  return null;
}

function buildStructuredNote(note: MemoryNoteRecord): JarvisMemoryContextNote {
  return {
    id: note.id,
    kind: note.kind,
    title: note.title,
    content: note.content,
    key: note.key,
    value: note.value,
    attributes: note.attributes,
    tags: note.tags,
    pinned: note.pinned,
    source: note.source,
    relatedSessionId: note.relatedSessionId,
    relatedTaskId: note.relatedTaskId,
    updatedAt: note.updatedAt,
  };
}

export function resolveMemoryBackedRouting(input: {
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
  model?: string;
  memoryPreferences: JarvisMemoryPreferenceHints | null;
}): { provider?: ProviderName | 'auto'; strictProvider?: boolean; model?: string; applied: string[] } {
  const applied: string[] = [];
  let provider = input.provider;
  let model = input.model;
  let strictProvider = input.strictProvider;

  if ((typeof provider === 'undefined' || provider === 'auto') && input.memoryPreferences?.preferredProvider) {
    provider = input.memoryPreferences.preferredProvider;
    strictProvider = true;
    applied.push(`preferred_provider:${input.memoryPreferences.preferredProvider}`);
  }
  if (!model && input.memoryPreferences?.preferredModel) {
    model = input.memoryPreferences.preferredModel;
    applied.push(`preferred_model:${input.memoryPreferences.preferredModel}`);
  }

  return { provider, strictProvider, model, applied };
}

export function resolveJarvisMemoryPreferences(context: JarvisMemoryContext | null): JarvisMemoryPreferenceHints | null {
  return context?.preferences ?? null;
}

function resolveStructuredPreferences(notes: MemoryNoteRecord[]): JarvisMemoryPreferenceHints | null {
  let responseStyle: MemoryPreferenceResponseStyle | null = null;
  let preferredProvider: ProviderName | null = null;
  let preferredModel: string | null = null;
  let riskTolerance: MemoryPreferenceRiskTolerance | null = null;
  let approvalStyle: MemoryPreferenceApprovalStyle | null = null;
  let monitoringPreference: MemoryPreferenceMonitoring | null = null;
  let preferMonitorAfterBrief = false;
  let preferNotifyAfterMonitor = false;

  for (const note of notes) {
    if (note.kind !== 'user_preference' && note.kind !== 'project_context') continue;
    const haystack = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase();
    const key = note.key?.trim().toLowerCase() ?? null;
    const attrs = note.attributes ?? {};

    const explicitResponseStyle =
      (key === 'response_style' ? parseResponseStyle(note.value ?? attrs['value']) : null) ??
      parseResponseStyle(attrs['response_style']);
    if (explicitResponseStyle) {
      responseStyle = explicitResponseStyle;
    } else if (!responseStyle) {
      responseStyle = inferResponseStyleFromText(haystack);
    }

    const explicitProvider =
      (key === 'preferred_provider' ? parseProvider(note.value ?? attrs['value']) : null) ??
      parseProvider(attrs['preferred_provider']);
    if (explicitProvider) {
      preferredProvider = explicitProvider;
    } else if (!preferredProvider) {
      preferredProvider = parseProvider(haystack.match(/\b(openai|gemini|anthropic|local)\b/iu)?.[1] ?? null);
    }

    const explicitModel =
      (key === 'preferred_model' ? asString(note.value ?? attrs['value']) : null) ?? asString(attrs['preferred_model']);
    if (explicitModel) {
      preferredModel = explicitModel.toLowerCase();
      preferredProvider = inferProviderFromModel(preferredModel) ?? preferredProvider;
    } else if (!preferredModel) {
      const inferredModel = asString(haystack.match(MODEL_HINT_PATTERN)?.[1] ?? null);
      if (inferredModel) {
        preferredModel = inferredModel.toLowerCase();
        preferredProvider = inferProviderFromModel(preferredModel) ?? preferredProvider;
      }
    }

    const explicitRiskTolerance =
      (key === 'risk_tolerance' ? parseRiskTolerance(note.value ?? attrs['value']) : null) ??
      parseRiskTolerance(attrs['risk_tolerance']);
    if (explicitRiskTolerance) {
      riskTolerance = explicitRiskTolerance;
    } else if (!riskTolerance) {
      riskTolerance = inferRiskToleranceFromText(haystack);
    }

    const explicitApprovalStyle =
      (key === 'approval_style' ? parseApprovalStyle(note.value ?? attrs['value']) : null) ??
      parseApprovalStyle(attrs['approval_style']);
    if (explicitApprovalStyle) {
      approvalStyle = explicitApprovalStyle;
    } else if (!approvalStyle) {
      approvalStyle = inferApprovalStyleFromText(haystack);
    }

    const explicitMonitoringPreference =
      (key === 'monitoring_preference' ? parseMonitoringPreference(note.value ?? attrs['value']) : null) ??
      parseMonitoringPreference(attrs['monitoring_preference']);
    if (explicitMonitoringPreference) {
      monitoringPreference = explicitMonitoringPreference;
    } else if (!monitoringPreference) {
      monitoringPreference = inferMonitoringPreferenceFromText(haystack);
    }

    if (/(모니터|계속 추적|지속 추적|watch after|monitor after|브리프 뒤에도 계속|follow-up watch)/iu.test(haystack)) {
      preferMonitorAfterBrief = true;
    }
    if (/(변화가 있으면 알려|알려줘|notify|alert|ping me|notification)/iu.test(haystack)) {
      preferNotifyAfterMonitor = true;
    }
  }

  const summary: string[] = [];
  if (responseStyle === 'concise') {
    summary.push('Prefer concise responses when no explicit response format is requested.');
  } else if (responseStyle === 'balanced') {
    summary.push('Prefer balanced responses unless the request explicitly asks for brevity or depth.');
  } else if (responseStyle === 'detailed') {
    summary.push('Prefer detailed responses when scope is ambiguous.');
  }
  if (preferredProvider && preferredModel) {
    summary.push(`Bias default model routing toward ${preferredProvider}/${preferredModel} when no explicit model is selected.`);
  } else if (preferredProvider) {
    summary.push(`Bias default model routing toward ${preferredProvider} when no explicit model is selected.`);
  } else if (preferredModel) {
    summary.push(`Reuse preferred model ${preferredModel} when no explicit model is selected.`);
  }
  if (riskTolerance === 'cautious') {
    summary.push('Prefer conservative planning with risk and approval points surfaced early.');
  } else if (riskTolerance === 'aggressive') {
    summary.push('Prefer fast progress where safe, while keeping destructive actions approval-gated.');
  }
  if (approvalStyle === 'read_only_review') {
    summary.push('Default to read-only review before any write-capable execution path.');
  } else if (approvalStyle === 'safe_auto_run_preferred') {
    summary.push('Low-risk runtime health checks may auto-run when policy allows.');
  }
  if (monitoringPreference === 'manual') {
    summary.push('Do not auto-suggest monitor follow-up unless the request explicitly asks for ongoing tracking.');
  } else if (monitoringPreference === 'all_changes') {
    summary.push('Monitor follow-up may include low-severity changes when a related brief exists.');
  } else if (monitoringPreference === 'important_changes') {
    summary.push('Monitor follow-up should focus on important changes by default.');
  }
  if (preferMonitorAfterBrief) {
    summary.push('Create a follow-up monitor by default after policy, market, entity, or topic briefs when relevant.');
  }
  if (preferNotifyAfterMonitor) {
    summary.push('Arm notifications when a follow-up monitor is created.');
  }

  if (
    !responseStyle &&
    !preferredProvider &&
    !preferredModel &&
    !riskTolerance &&
    !approvalStyle &&
    !monitoringPreference &&
    !preferMonitorAfterBrief &&
    !preferNotifyAfterMonitor
  ) {
    return null;
  }

  return {
    responseStyle,
    preferredProvider,
    preferredModel,
    riskTolerance,
    approvalStyle,
    monitoringPreference,
    preferMonitorAfterBrief,
    preferNotifyAfterMonitor,
    summary,
  };
}

function resolveProjectContext(notes: MemoryNoteRecord[]): JarvisProjectContext | null {
  let repoSlug: string | null = null;
  let projectName: string | null = null;
  let goalSummary: string | null = null;
  const pinnedRefs = new Set<string>();
  const noteIds: string[] = [];

  for (const note of notes) {
    if (note.kind !== 'project_context') continue;
    noteIds.push(note.id);
    const attrs = note.attributes ?? {};
    const haystack = `${note.title} ${note.content} ${note.tags.join(' ')}`;
    if (!repoSlug) {
      repoSlug = asString(attrs['repo_slug']) ?? asString(note.value) ?? asString(haystack.match(REPO_SLUG_PATTERN)?.[1] ?? null);
    }
    if (!projectName) {
      projectName = asString(attrs['project_name']) ?? asString(note.title.replace(/^Plan:\s*/iu, '')) ?? null;
    }
    if (!goalSummary) {
      goalSummary = asString(attrs['goal_summary']) ?? asString(note.content);
    }
    for (const ref of asStringArray(attrs['pinned_refs'])) {
      pinnedRefs.add(ref);
    }
  }

  if (!repoSlug && !projectName && !goalSummary && pinnedRefs.size === 0) {
    return null;
  }

  const summary: string[] = [];
  if (projectName) summary.push(`Project context: ${projectName}`);
  if (repoSlug) summary.push(`Primary repository context: ${repoSlug}`);
  if (goalSummary) summary.push(`Current project goal is captured in memory context.`);
  if (pinnedRefs.size > 0) summary.push(`${pinnedRefs.size} pinned project reference(s) are available.`);

  return {
    repoSlug,
    projectName,
    goalSummary,
    pinnedRefs: [...pinnedRefs],
    noteIds,
    summary,
  };
}

function resolveRecentDecisionSignals(notes: MemoryNoteRecord[]): JarvisRecentDecisionSignals {
  const signals: JarvisRecentDecisionSignals = {
    recentApprovalHistory: false,
    recentRejectionHistory: false,
    approvalSensitivePreference: false,
    safeAutoRunAcceptance: false,
    summary: [],
  };

  for (const note of notes) {
    const haystack = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase();
    if (note.kind === 'decision_memory') {
      if (/(approved|승인|accepted|allow)/iu.test(haystack)) {
        signals.recentApprovalHistory = true;
      }
      if (/(rejected|거절|blocked|보류|denied|declined)/iu.test(haystack)) {
        signals.recentRejectionHistory = true;
      }
      if (/(safe_auto_run|자동 실행 허용|안전 자동 실행 승인)/iu.test(haystack)) {
        signals.safeAutoRunAcceptance = true;
      }
    }
    if (note.kind === 'user_preference' || note.kind === 'project_context') {
      if (/(approval|승인|human.?gate|검토 필요|high.?risk|고위험)/iu.test(haystack)) {
        signals.approvalSensitivePreference = true;
      }
    }
  }

  if (signals.recentApprovalHistory) signals.summary.push('Recent approval history is available.');
  if (signals.recentRejectionHistory) signals.summary.push('Recent rejection history suggests more conservative follow-up.');
  if (signals.approvalSensitivePreference) signals.summary.push('Approval-sensitive preferences are present in memory.');
  if (signals.safeAutoRunAcceptance) signals.summary.push('Safe auto-run has been accepted in recent decisions.');

  return signals;
}

function buildMemoryContextFromNotes(notes: MemoryNoteRecord[], prompt: string, limit = 4): JarvisMemoryContext | null {
  if (notes.length === 0) return null;

  const sorted = [...notes].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const preferences = resolveStructuredPreferences(sorted);
  const projectContext = resolveProjectContext(sorted);
  const recentDecisionSignals = resolveRecentDecisionSignals(sorted);

  const promptTokens = tokenize(prompt);
  const ranked = sorted
    .map((note) => ({ note, score: scoreNote(promptTokens, note) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.note.updatedAt) - Date.parse(left.note.updatedAt))
    .slice(0, limit)
    .map((entry) => entry.note);

  const relevantNotes = ranked.length > 0 ? ranked : sorted.slice(0, limit);
  const structuredNotes = sorted
    .filter((note) => note.kind === 'user_preference' || note.kind === 'project_context')
    .slice(0, 16)
    .map(buildStructuredNote);

  return {
    notes: relevantNotes.map(buildStructuredNote),
    structuredNotes,
    summary: buildSummary(relevantNotes, preferences, projectContext),
    appliedHints: buildAppliedHints(relevantNotes, preferences, projectContext),
    preferences,
    projectContext,
    recentDecisionSignals,
  };
}

function buildMemoryPlanSummary(
  signals: JarvisMemoryPlanSignal[],
  preferences: JarvisMemoryPreferenceHints | null,
  projectContext: JarvisProjectContext | null,
  recentDecisionSignals: JarvisRecentDecisionSignals
): string[] {
  const lines: string[] = [];
  if (signals.includes('pinned_context')) {
    lines.push('Pinned context is treated as a hard preference baseline for this session.');
  }
  if (signals.includes('project_context_available')) {
    lines.push('Related project context is available and should constrain scope before new plans expand.');
  }
  if (signals.includes('research_history_available')) {
    lines.push('Prior research memory exists and should be reused before starting from zero.');
  }
  if (signals.includes('risk_first_preference') || signals.includes('cautious_risk_preference')) {
    lines.push('Risk and approval points should be surfaced before execution details.');
  }
  if (signals.includes('approval_sensitive_preference') || signals.includes('read_only_review_preference')) {
    lines.push('Approval-sensitive behavior should stay explicit and conservative.');
  }
  if (signals.includes('safe_auto_run_preference')) {
    lines.push('Safe low-risk auto-run paths may be used when policy allows.');
  }
  if (signals.includes('recent_rejection_history')) {
    lines.push('Recent rejection history suggests staying conservative on execution and approval gating.');
  } else if (signals.includes('recent_approval_history')) {
    lines.push('Recent approval history is available for execution planning context.');
  }
  if (signals.includes('monitor_followup_preference')) {
    lines.push('Relevant research sessions should create a follow-up monitor by default.');
  }
  if (signals.includes('notify_followup_preference')) {
    lines.push('Monitor-driven changes should be surfaced through notifications.');
  }
  if (signals.includes('manual_monitoring_preference')) {
    lines.push('Auto-created monitoring should stay minimal unless explicitly requested.');
  } else if (signals.includes('all_changes_monitoring_preference')) {
    lines.push('Lower-severity monitor changes can still be proposed for review.');
  }
  if (signals.includes('concise_response_preference')) {
    lines.push('Responses should stay concise unless the request asks for detail.');
  } else if (signals.includes('balanced_response_preference')) {
    lines.push('Responses should stay balanced unless the request explicitly asks for brevity or depth.');
  } else if (signals.includes('detailed_response_preference')) {
    lines.push('Responses should stay detailed unless the request asks for brevity.');
  }
  if (signals.includes('preferred_provider_available')) {
    lines.push('A default provider preference is available for routing.');
  }
  if (signals.includes('preferred_model_available')) {
    lines.push('A preferred model is available for default routing.');
  }
  if (preferences?.summary?.length) {
    lines.push(...preferences.summary);
  }
  if (projectContext?.summary?.length) {
    lines.push(...projectContext.summary);
  }
  if (recentDecisionSignals.summary.length) {
    lines.push(...recentDecisionSignals.summary);
  }
  return Array.from(new Set(lines));
}

export function resolveJarvisMemoryPlan(context: JarvisMemoryContext | null): JarvisMemoryPlan | null {
  if (!context) return null;

  const signals = new Set<JarvisMemoryPlanSignal>();
  for (const note of context.notes) {
    if (note.pinned) {
      signals.add('pinned_context');
    }
    if (note.kind === 'research_memory') {
      signals.add('research_history_available');
    }
  }

  const preferences = context.preferences;
  const projectContext = context.projectContext;
  const recentDecisionSignals = context.recentDecisionSignals;

  if (projectContext) {
    signals.add('project_context_available');
  }
  if (recentDecisionSignals.recentApprovalHistory) {
    signals.add('recent_approval_history');
  }
  if (recentDecisionSignals.recentRejectionHistory) {
    signals.add('recent_rejection_history');
  }
  if (recentDecisionSignals.approvalSensitivePreference) {
    signals.add('approval_sensitive_preference');
  }
  if (preferences?.riskTolerance === 'cautious') {
    signals.add('risk_first_preference');
    signals.add('cautious_risk_preference');
  } else if (preferences?.riskTolerance === 'aggressive') {
    signals.add('aggressive_risk_preference');
  }
  if (preferences?.approvalStyle === 'read_only_review') {
    signals.add('approval_sensitive_preference');
    signals.add('read_only_review_preference');
  } else if (preferences?.approvalStyle === 'safe_auto_run_preferred' || recentDecisionSignals.safeAutoRunAcceptance) {
    signals.add('safe_auto_run_preference');
  }
  if (preferences?.monitoringPreference === 'manual') {
    signals.add('manual_monitoring_preference');
  } else if (preferences?.monitoringPreference === 'all_changes') {
    signals.add('all_changes_monitoring_preference');
  }
  if (preferences?.preferMonitorAfterBrief) {
    signals.add('monitor_followup_preference');
  }
  if (preferences?.preferNotifyAfterMonitor) {
    signals.add('notify_followup_preference');
  }
  if (preferences?.responseStyle === 'concise') {
    signals.add('concise_response_preference');
  } else if (preferences?.responseStyle === 'balanced') {
    signals.add('balanced_response_preference');
  } else if (preferences?.responseStyle === 'detailed') {
    signals.add('detailed_response_preference');
  }
  if (preferences?.preferredProvider) {
    signals.add('preferred_provider_available');
  }
  if (preferences?.preferredModel) {
    signals.add('preferred_model_available');
  }

  const orderedSignals = Array.from(signals);
  if (orderedSignals.length === 0) return null;
  return {
    signals: orderedSignals,
    summary: buildMemoryPlanSummary(orderedSignals, preferences, projectContext, recentDecisionSignals),
  };
}

export function buildPlannerPromptWithMemory(prompt: string, memoryPlan: JarvisMemoryPlan | null): string {
  if (!memoryPlan || memoryPlan.summary.length === 0) return prompt;
  return `${prompt}\n\nPlanner memory context:\n${memoryPlan.summary.map((line) => `- ${line}`).join('\n')}`;
}

export function buildResponseInstructionWithMemory(input: {
  preferences: JarvisMemoryPreferenceHints | null;
  memoryPlan: JarvisMemoryPlan | null;
  expectedLanguage?: string | null;
}): string {
  const lines: string[] = [];
  const useKorean = input.expectedLanguage === 'ko';
  const signals = new Set(input.memoryPlan?.signals ?? []);
  const responseStyle = input.preferences?.responseStyle;
  const concisePreferred = responseStyle === 'concise' || signals.has('concise_response_preference');
  const detailedPreferred = responseStyle === 'detailed' || signals.has('detailed_response_preference');
  const riskFirst =
    signals.has('risk_first_preference') ||
    signals.has('approval_sensitive_preference') ||
    signals.has('recent_rejection_history');

  if (concisePreferred) {
    lines.push(
      useKorean
        ? '답변은 불필요한 장황함 없이 핵심만 짧게 정리합니다. 요청이 길지 않다면 짧은 단락이나 짧은 목록으로 답변합니다.'
        : 'Keep answers concise. When the request does not demand depth, prefer short paragraphs or a compact bullet list.'
    );
  } else if (detailedPreferred) {
    lines.push(
      useKorean
        ? '답변은 배경, 근거, 다음 단계가 드러나도록 충분히 상세하게 정리합니다.'
        : 'Prefer a detailed response with clear background, evidence, and next steps when scope is ambiguous.'
    );
  }

  if (riskFirst) {
    lines.push(
      useKorean
        ? '실행 제안이나 행동 지침이 포함되면, 실행 세부 정보보다 먼저 리스크와 승인 포인트를 분명하게 설명합니다.'
        : 'When suggesting actions or execution steps, surface risks and approval checkpoints before execution detail.'
    );
  }

  if (signals.has('recent_rejection_history')) {
    lines.push(
      useKorean
        ? '최근 거절 이력이 있으므로 되돌리기 쉬운 선택지와 보수적인 대안을 우선 제안합니다.'
        : 'Recent rejection history exists, so prefer reversible options and conservative alternatives first.'
    );
  } else if (signals.has('recent_approval_history') && riskFirst) {
    lines.push(
      useKorean
        ? '승인 이력이 있더라도 자동 실행처럼 들리지 않게, 검토 지점과 책임 구분을 유지합니다.'
        : 'Even with prior approvals, keep review checkpoints explicit and avoid implying automatic execution.'
    );
  }

  return lines.join('\n');
}

export async function resolveJarvisMemoryContext(
  store: JarvisStore,
  input: { userId: string; prompt: string; limit?: number }
): Promise<JarvisMemoryContext | null> {
  const notes = await store.listMemoryNotes({ userId: input.userId, limit: 80 });
  return buildMemoryContextFromNotes(notes, input.prompt, input.limit ?? 4);
}
