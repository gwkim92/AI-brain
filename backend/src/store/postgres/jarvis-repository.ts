import type { Pool } from 'pg';

import type { JarvisRepositoryContract } from '../repository-contracts';
import type {
  ActionProposalRow,
  BriefingRow,
  DossierClaimRow,
  DossierRow,
  DossierSourceRow,
  JarvisSessionEventRow,
  JarvisSessionRow,
  WatcherRow,
  WatcherRunRow
} from './types';

const DEFAULT_LIMIT = 100;

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function mapJarvisSessionRow(row: JarvisSessionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    prompt: row.prompt,
    source: row.source,
    intent: row.intent,
    status: row.status,
    workspacePreset: row.workspace_preset,
    primaryTarget: row.primary_target,
    taskId: row.task_id,
    missionId: row.mission_id,
    assistantContextId: row.assistant_context_id,
    councilRunId: row.council_run_id,
    executionRunId: row.execution_run_id,
    briefingId: row.briefing_id,
    dossierId: row.dossier_id,
    lastEventAt: row.last_event_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapJarvisSessionEventRow(row: JarvisSessionEventRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: typeof row.sequence === 'number' ? row.sequence : Number.parseInt(String(row.sequence), 10),
    eventType: row.event_type,
    status: row.status,
    summary: row.summary,
    data: row.data ?? {},
    createdAt: row.created_at.toISOString()
  };
}

function mapActionProposalRow(row: ActionProposalRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    status: row.status,
    payload: row.payload ?? {},
    decidedAt: row.decided_at?.toISOString() ?? null,
    decidedBy: row.decided_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapWatcherRow(row: WatcherRow) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    query: row.query,
    configJson: row.config_json ?? {},
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    lastHitAt: row.last_hit_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapWatcherRunRow(row: WatcherRunRow) {
  return {
    id: row.id,
    watcherId: row.watcher_id,
    userId: row.user_id,
    status: row.status,
    summary: row.summary,
    briefingId: row.briefing_id,
    dossierId: row.dossier_id,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapBriefingRow(row: BriefingRow) {
  return {
    id: row.id,
    userId: row.user_id,
    watcherId: row.watcher_id,
    sessionId: row.session_id,
    type: row.type,
    status: row.status,
    title: row.title,
    query: row.query,
    summary: row.summary,
    answerMarkdown: row.answer_markdown,
    sourceCount: row.source_count,
    qualityJson: row.quality_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapDossierRow(row: DossierRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    briefingId: row.briefing_id,
    title: row.title,
    query: row.query,
    status: row.status,
    summary: row.summary,
    answerMarkdown: row.answer_markdown,
    qualityJson: row.quality_json ?? {},
    conflictsJson: row.conflicts_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapDossierSourceRow(row: DossierSourceRow) {
  return {
    id: row.id,
    dossierId: row.dossier_id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    snippet: row.snippet,
    publishedAt: row.published_at?.toISOString() ?? null,
    sourceOrder: row.source_order,
    createdAt: row.created_at.toISOString()
  };
}

function mapDossierClaimRow(row: DossierClaimRow) {
  return {
    id: row.id,
    dossierId: row.dossier_id,
    claimText: row.claim_text,
    claimOrder: row.claim_order,
    sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
    createdAt: row.created_at.toISOString()
  };
}

export function createJarvisRepository({ pool }: { pool: Pool }): JarvisRepositoryContract {
  return {
    async createJarvisSession(input) {
      const { rows } = await pool.query<JarvisSessionRow>(
        `
          INSERT INTO jarvis_sessions (
            id, user_id, title, prompt, source, intent, status, workspace_preset, primary_target,
            task_id, mission_id, assistant_context_id, council_run_id, execution_run_id, briefing_id, dossier_id
          )
          VALUES (
            COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3, $4, $5, $6, COALESCE($7, 'queued'), $8, $9,
            $10::uuid, $11::uuid, $12::uuid, $13::uuid, $14::uuid, $15::uuid, $16::uuid
          )
          RETURNING *
        `,
        [
          input.id ?? null,
          input.userId,
          input.title,
          input.prompt,
          input.source,
          input.intent,
          input.status ?? 'queued',
          input.workspacePreset ?? null,
          input.primaryTarget,
          input.taskId ?? null,
          input.missionId ?? null,
          input.assistantContextId ?? null,
          input.councilRunId ?? null,
          input.executionRunId ?? null,
          input.briefingId ?? null,
          input.dossierId ?? null
        ]
      );
      if (!rows[0]) throw new Error('failed to create jarvis session');
      return mapJarvisSessionRow(rows[0]);
    },

    async listJarvisSessions(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<JarvisSessionRow>(
        `
          SELECT *
          FROM jarvis_sessions
          WHERE ${filters.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT $${values.length}
        `,
        values
      );
      return rows.map(mapJarvisSessionRow);
    },

    async getJarvisSessionById(input) {
      const { rows } = await pool.query<JarvisSessionRow>(
        `SELECT * FROM jarvis_sessions WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [input.sessionId, input.userId]
      );
      return rows[0] ? mapJarvisSessionRow(rows[0]) : null;
    },

    async updateJarvisSession(input) {
      const current = await pool.query<JarvisSessionRow>(
        `SELECT * FROM jarvis_sessions WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [input.sessionId, input.userId]
      );
      if (!current.rows[0]) return null;
      const row = current.rows[0];
      const { rows } = await pool.query<JarvisSessionRow>(
        `
          UPDATE jarvis_sessions
          SET
            title = COALESCE($3, title),
            prompt = COALESCE($4, prompt),
            status = COALESCE($5, status),
            workspace_preset = CASE WHEN $6::text IS NULL AND $15 = false THEN workspace_preset ELSE $6 END,
            primary_target = COALESCE($7, primary_target),
            task_id = CASE WHEN $8::uuid IS NULL AND $16 = false THEN task_id ELSE $8::uuid END,
            mission_id = CASE WHEN $9::uuid IS NULL AND $17 = false THEN mission_id ELSE $9::uuid END,
            assistant_context_id = CASE WHEN $10::uuid IS NULL AND $18 = false THEN assistant_context_id ELSE $10::uuid END,
            council_run_id = CASE WHEN $11::uuid IS NULL AND $19 = false THEN council_run_id ELSE $11::uuid END,
            execution_run_id = CASE WHEN $12::uuid IS NULL AND $20 = false THEN execution_run_id ELSE $12::uuid END,
            briefing_id = CASE WHEN $13::uuid IS NULL AND $21 = false THEN briefing_id ELSE $13::uuid END,
            dossier_id = CASE WHEN $14::uuid IS NULL AND $22 = false THEN dossier_id ELSE $14::uuid END,
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.sessionId,
          input.userId,
          input.title ?? null,
          input.prompt ?? null,
          input.status ?? null,
          Object.prototype.hasOwnProperty.call(input, 'workspacePreset') ? (input.workspacePreset ?? null) : row.workspace_preset,
          input.primaryTarget ?? null,
          Object.prototype.hasOwnProperty.call(input, 'taskId') ? (input.taskId ?? null) : row.task_id,
          Object.prototype.hasOwnProperty.call(input, 'missionId') ? (input.missionId ?? null) : row.mission_id,
          Object.prototype.hasOwnProperty.call(input, 'assistantContextId') ? (input.assistantContextId ?? null) : row.assistant_context_id,
          Object.prototype.hasOwnProperty.call(input, 'councilRunId') ? (input.councilRunId ?? null) : row.council_run_id,
          Object.prototype.hasOwnProperty.call(input, 'executionRunId') ? (input.executionRunId ?? null) : row.execution_run_id,
          Object.prototype.hasOwnProperty.call(input, 'briefingId') ? (input.briefingId ?? null) : row.briefing_id,
          Object.prototype.hasOwnProperty.call(input, 'dossierId') ? (input.dossierId ?? null) : row.dossier_id,
          Object.prototype.hasOwnProperty.call(input, 'workspacePreset'),
          Object.prototype.hasOwnProperty.call(input, 'taskId'),
          Object.prototype.hasOwnProperty.call(input, 'missionId'),
          Object.prototype.hasOwnProperty.call(input, 'assistantContextId'),
          Object.prototype.hasOwnProperty.call(input, 'councilRunId'),
          Object.prototype.hasOwnProperty.call(input, 'executionRunId'),
          Object.prototype.hasOwnProperty.call(input, 'briefingId'),
          Object.prototype.hasOwnProperty.call(input, 'dossierId')
        ]
      );
      return rows[0] ? mapJarvisSessionRow(rows[0]) : null;
    },

    async appendJarvisSessionEvent(input) {
      const { rows } = await pool.query<JarvisSessionEventRow>(
        `
          WITH session_row AS (
            SELECT id, status FROM jarvis_sessions WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1
          ), inserted AS (
            INSERT INTO jarvis_session_events (session_id, event_type, status, summary, data)
            SELECT id, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb)
            FROM session_row
            RETURNING *
          ), updated AS (
            UPDATE jarvis_sessions
            SET
              status = COALESCE($4, jarvis_sessions.status),
              updated_at = now(),
              last_event_at = now()
            WHERE id IN (SELECT id FROM session_row)
            RETURNING id
          )
          SELECT * FROM inserted
        `,
        [input.sessionId, input.userId, input.eventType, input.status ?? null, input.summary ?? null, JSON.stringify(input.data ?? {})]
      );
      return rows[0] ? mapJarvisSessionEventRow(rows[0]) : null;
    },

    async listJarvisSessionEvents(input) {
      const values: unknown[] = [input.sessionId, input.userId];
      const filters = [
        'e.session_id = $1::uuid',
        's.user_id = $2::uuid'
      ];
      if (typeof input.sinceSequence === 'number') {
        values.push(input.sinceSequence);
        filters.push(`e.sequence > $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<JarvisSessionEventRow>(
        `
          SELECT e.*
          FROM jarvis_session_events e
          INNER JOIN jarvis_sessions s ON s.id = e.session_id
          WHERE ${filters.join(' AND ')}
          ORDER BY e.sequence ASC
          LIMIT $${values.length}
        `,
        values
      );
      return rows.map(mapJarvisSessionEventRow);
    },

    async createActionProposal(input) {
      const { rows } = await pool.query<ActionProposalRow>(
        `
          INSERT INTO action_proposals (user_id, session_id, kind, title, summary, payload)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [input.userId, input.sessionId, input.kind, input.title, input.summary, JSON.stringify(input.payload ?? {})]
      );
      if (!rows[0]) throw new Error('failed to create action proposal');
      return mapActionProposalRow(rows[0]);
    },

    async listActionProposals(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.sessionId) {
        values.push(input.sessionId);
        filters.push(`session_id = $${values.length}::uuid`);
      }
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<ActionProposalRow>(
        `SELECT * FROM action_proposals WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapActionProposalRow);
    },

    async decideActionProposal(input) {
      const { rows } = await pool.query<ActionProposalRow>(
        `
          UPDATE action_proposals
          SET status = $3, decided_by = $4::uuid, decided_at = now(), updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [input.proposalId, input.userId, input.decision, input.decidedBy]
      );
      return rows[0] ? mapActionProposalRow(rows[0]) : null;
    },

    async createWatcher(input) {
      const { rows } = await pool.query<WatcherRow>(
        `
          INSERT INTO watchers (user_id, kind, status, title, query, config_json)
          VALUES ($1::uuid, $2, COALESCE($3, 'active'), $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [input.userId, input.kind, input.status ?? 'active', input.title, input.query, JSON.stringify(input.configJson ?? {})]
      );
      if (!rows[0]) throw new Error('failed to create watcher');
      return mapWatcherRow(rows[0]);
    },

    async listWatchers(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      if (input.kind) {
        values.push(input.kind);
        filters.push(`kind = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WatcherRow>(
        `SELECT * FROM watchers WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWatcherRow);
    },

    async listActiveWatchers(input) {
      const { rows } = await pool.query<WatcherRow>(
        `
          SELECT *
          FROM watchers
          WHERE status = 'active'
          ORDER BY COALESCE(last_run_at, updated_at, created_at) ASC, created_at ASC
          LIMIT $1
        `,
        [normalizeLimit(input.limit)]
      );
      return rows.map(mapWatcherRow);
    },

    async getWatcherById(input) {
      const { rows } = await pool.query<WatcherRow>(
        `SELECT * FROM watchers WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [input.watcherId, input.userId]
      );
      return rows[0] ? mapWatcherRow(rows[0]) : null;
    },

    async updateWatcher(input) {
      const { rows } = await pool.query<WatcherRow>(
        `
          UPDATE watchers
          SET
            kind = COALESCE($3, kind),
            status = COALESCE($4, status),
            title = COALESCE($5, title),
            query = COALESCE($6, query),
            config_json = COALESCE($7::jsonb, config_json),
            last_run_at = COALESCE($8::timestamptz, last_run_at),
            last_hit_at = COALESCE($9::timestamptz, last_hit_at),
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.watcherId,
          input.userId,
          input.kind ?? null,
          input.status ?? null,
          input.title ?? null,
          input.query ?? null,
          typeof input.configJson === 'object' && input.configJson !== null ? JSON.stringify(input.configJson) : null,
          input.lastRunAt ?? null,
          input.lastHitAt ?? null
        ]
      );
      return rows[0] ? mapWatcherRow(rows[0]) : null;
    },

    async deleteWatcher(input) {
      const result = await pool.query(`DELETE FROM watchers WHERE id = $1::uuid AND user_id = $2::uuid`, [input.watcherId, input.userId]);
      return (result.rowCount ?? 0) > 0;
    },

    async createWatcherRun(input) {
      const { rows } = await pool.query<WatcherRunRow>(
        `
          INSERT INTO watcher_runs (watcher_id, user_id, status, summary, briefing_id, dossier_id, error)
          VALUES ($1::uuid, $2::uuid, COALESCE($3, 'running'), $4, $5::uuid, $6::uuid, $7)
          RETURNING *
        `,
        [input.watcherId, input.userId, input.status ?? 'running', input.summary ?? '', input.briefingId ?? null, input.dossierId ?? null, input.error ?? null]
      );
      if (!rows[0]) throw new Error('failed to create watcher run');
      return mapWatcherRunRow(rows[0]);
    },

    async listWatcherRuns(input) {
      const { rows } = await pool.query<WatcherRunRow>(
        `
          SELECT *
          FROM watcher_runs
          WHERE watcher_id = $1::uuid AND user_id = $2::uuid
          ORDER BY updated_at DESC
          LIMIT $3
        `,
        [input.watcherId, input.userId, normalizeLimit(input.limit)]
      );
      return rows.map(mapWatcherRunRow);
    },

    async updateWatcherRun(input) {
      const { rows } = await pool.query<WatcherRunRow>(
        `
          UPDATE watcher_runs
          SET
            status = COALESCE($3, status),
            summary = COALESCE($4, summary),
            briefing_id = COALESCE($5::uuid, briefing_id),
            dossier_id = COALESCE($6::uuid, dossier_id),
            error = COALESCE($7, error),
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [input.runId, input.userId, input.status ?? null, input.summary ?? null, input.briefingId ?? null, input.dossierId ?? null, input.error ?? null]
      );
      return rows[0] ? mapWatcherRunRow(rows[0]) : null;
    },

    async createBriefing(input) {
      const { rows } = await pool.query<BriefingRow>(
        `
          INSERT INTO briefings (user_id, watcher_id, session_id, type, status, title, query, summary, answer_markdown, source_count, quality_json)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, COALESCE($5, 'completed'), $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.watcherId ?? null,
          input.sessionId ?? null,
          input.type,
          input.status ?? 'completed',
          input.title,
          input.query,
          input.summary,
          input.answerMarkdown,
          input.sourceCount ?? 0,
          JSON.stringify(input.qualityJson ?? {})
        ]
      );
      if (!rows[0]) throw new Error('failed to create briefing');
      return mapBriefingRow(rows[0]);
    },

    async listBriefings(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.type) {
        values.push(input.type);
        filters.push(`type = $${values.length}`);
      }
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<BriefingRow>(
        `SELECT * FROM briefings WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapBriefingRow);
    },

    async getBriefingById(input) {
      const { rows } = await pool.query<BriefingRow>(
        `SELECT * FROM briefings WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [input.briefingId, input.userId]
      );
      return rows[0] ? mapBriefingRow(rows[0]) : null;
    },

    async createDossier(input) {
      const { rows } = await pool.query<DossierRow>(
        `
          INSERT INTO dossiers (user_id, session_id, briefing_id, title, query, status, summary, answer_markdown, quality_json, conflicts_json)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, COALESCE($6, 'draft'), $7, $8, COALESCE($9::jsonb, '{}'::jsonb), COALESCE($10::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.sessionId ?? null,
          input.briefingId ?? null,
          input.title,
          input.query,
          input.status ?? 'draft',
          input.summary ?? '',
          input.answerMarkdown ?? '',
          JSON.stringify(input.qualityJson ?? {}),
          JSON.stringify(input.conflictsJson ?? {})
        ]
      );
      if (!rows[0]) throw new Error('failed to create dossier');
      return mapDossierRow(rows[0]);
    },

    async listDossiers(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<DossierRow>(
        `SELECT * FROM dossiers WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapDossierRow);
    },

    async getDossierById(input) {
      const { rows } = await pool.query<DossierRow>(
        `SELECT * FROM dossiers WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [input.dossierId, input.userId]
      );
      return rows[0] ? mapDossierRow(rows[0]) : null;
    },

    async updateDossier(input) {
      const { rows } = await pool.query<DossierRow>(
        `
          UPDATE dossiers
          SET
            title = COALESCE($3, title),
            query = COALESCE($4, query),
            status = COALESCE($5, status),
            summary = COALESCE($6, summary),
            answer_markdown = COALESCE($7, answer_markdown),
            quality_json = COALESCE($8::jsonb, quality_json),
            conflicts_json = COALESCE($9::jsonb, conflicts_json),
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.dossierId,
          input.userId,
          input.title ?? null,
          input.query ?? null,
          input.status ?? null,
          input.summary ?? null,
          input.answerMarkdown ?? null,
          typeof input.qualityJson === 'object' && input.qualityJson !== null ? JSON.stringify(input.qualityJson) : null,
          typeof input.conflictsJson === 'object' && input.conflictsJson !== null ? JSON.stringify(input.conflictsJson) : null
        ]
      );
      return rows[0] ? mapDossierRow(rows[0]) : null;
    },

    async replaceDossierSources(input) {
      const dossier = await pool.query<DossierRow>(`SELECT id FROM dossiers WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`, [input.dossierId, input.userId]);
      if (!dossier.rows[0]) return [];
      await pool.query(`DELETE FROM dossier_sources WHERE dossier_id = $1::uuid`, [input.dossierId]);
      const rows: ReturnType<typeof mapDossierSourceRow>[] = [];
      for (let index = 0; index < input.sources.length; index += 1) {
        const source = input.sources[index]!;
        const inserted = await pool.query<DossierSourceRow>(
          `
            INSERT INTO dossier_sources (dossier_id, url, title, domain, snippet, published_at, source_order)
            VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7)
            RETURNING *
          `,
          [input.dossierId, source.url, source.title, source.domain, source.snippet ?? '', source.publishedAt ?? null, index + 1]
        );
        if (inserted.rows[0]) rows.push(mapDossierSourceRow(inserted.rows[0]));
      }
      return rows;
    },

    async listDossierSources(input) {
      const { rows } = await pool.query<DossierSourceRow>(
        `
          SELECT ds.*
          FROM dossier_sources ds
          INNER JOIN dossiers d ON d.id = ds.dossier_id
          WHERE ds.dossier_id = $1::uuid AND d.user_id = $2::uuid
          ORDER BY ds.source_order ASC
          LIMIT $3
        `,
        [input.dossierId, input.userId, normalizeLimit(input.limit)]
      );
      return rows.map(mapDossierSourceRow);
    },

    async replaceDossierClaims(input) {
      const dossier = await pool.query<DossierRow>(`SELECT id FROM dossiers WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`, [input.dossierId, input.userId]);
      if (!dossier.rows[0]) return [];
      await pool.query(`DELETE FROM dossier_claims WHERE dossier_id = $1::uuid`, [input.dossierId]);
      const rows: ReturnType<typeof mapDossierClaimRow>[] = [];
      for (let index = 0; index < input.claims.length; index += 1) {
        const claim = input.claims[index]!;
        const inserted = await pool.query<DossierClaimRow>(
          `
            INSERT INTO dossier_claims (dossier_id, claim_text, claim_order, source_urls)
            VALUES ($1::uuid, $2, $3, $4::text[])
            RETURNING *
          `,
          [input.dossierId, claim.claimText, index + 1, claim.sourceUrls]
        );
        if (inserted.rows[0]) rows.push(mapDossierClaimRow(inserted.rows[0]));
      }
      return rows;
    },

    async listDossierClaims(input) {
      const { rows } = await pool.query<DossierClaimRow>(
        `
          SELECT dc.*
          FROM dossier_claims dc
          INNER JOIN dossiers d ON d.id = dc.dossier_id
          WHERE dc.dossier_id = $1::uuid AND d.user_id = $2::uuid
          ORDER BY dc.claim_order ASC
          LIMIT $3
        `,
        [input.dossierId, input.userId, normalizeLimit(input.limit)]
      );
      return rows.map(mapDossierClaimRow);
    }
  };
}
