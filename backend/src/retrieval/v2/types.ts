import type { V2RiskLevel, V2RoutingIntent } from '../../store/types';

export type RetrievalAdapterId = 'brave_web' | 'crossref_scholar' | 'github_code';
export type RetrievalRunStatus = 'completed' | 'failed' | 'skipped';

export type RetrievalSubQueryV2 = {
  id: string;
  text: string;
};

export type RetrievalAdapterQueryInputV2 = {
  subQuery: RetrievalSubQueryV2;
  maxItems: number;
  nowIso: string;
};

export type RetrievalEvidenceCandidateV2 = {
  runKey: string;
  subQueryId: string;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
  connector: string;
  rankScore: number;
  metadata: Record<string, unknown>;
};

export type RetrievalAdapterQueryResultV2 = {
  items: RetrievalEvidenceCandidateV2[];
};

export type RetrievalAdapterV2 = {
  id: RetrievalAdapterId;
  query: (input: RetrievalAdapterQueryInputV2) => Promise<RetrievalAdapterQueryResultV2>;
};

export type RetrievalQueryRunV2 = {
  runKey: string;
  subQueryId: string;
  subQuery: string;
  adapterId: RetrievalAdapterId;
  status: RetrievalRunStatus;
  latencyMs: number;
  error?: string;
  itemCount: number;
};

export type RetrievalScoreSummaryV2 = {
  trustScore: number;
  coverageScore: number;
  freshnessScore: number;
  diversityScore: number;
};

export type RetrievalQualityGateV2 = {
  blocked: boolean;
  blockedReasons: string[];
};

export type RetrievalOrchestratorInputV2 = {
  query: string;
  maxItems: number;
  riskLevel: V2RiskLevel;
  intent: V2RoutingIntent;
};

export type RetrievalOrchestratorResultV2 = {
  normalizedQuery: string;
  subQueries: RetrievalSubQueryV2[];
  runs: RetrievalQueryRunV2[];
  evidenceItems: RetrievalEvidenceCandidateV2[];
  score: RetrievalScoreSummaryV2;
  gate: RetrievalQualityGateV2;
};
