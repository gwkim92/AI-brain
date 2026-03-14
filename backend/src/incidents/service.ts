import { randomUUID } from 'node:crypto';

import type { UserRole } from '../store/types';

export type IncidentRecordV2 = {
  id: string;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'rolling_back' | 'resolved';
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RollbackActionRecordV2 = {
  id: string;
  incidentId: string;
  actorUserId: string;
  actionType: string;
  status: 'completed' | 'failed';
  result: Record<string, unknown>;
  createdAt: string;
};

export class IncidentServiceV2 {
  private readonly incidents = new Map<string, IncidentRecordV2>();
  private readonly rollbackActions = new Map<string, RollbackActionRecordV2>();

  createIncident(input: {
    incidentType: string;
    severity: IncidentRecordV2['severity'];
    summary: string;
    metadata?: Record<string, unknown>;
  }): IncidentRecordV2 {
    const now = new Date().toISOString();
    const incident: IncidentRecordV2 = {
      id: randomUUID(),
      incidentType: input.incidentType,
      severity: input.severity,
      status: 'open',
      summary: input.summary,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  getIncident(incidentId: string): IncidentRecordV2 | null {
    return this.incidents.get(incidentId) ?? null;
  }

  listRollbackActions(incidentId: string): RollbackActionRecordV2[] {
    return Array.from(this.rollbackActions.values()).filter((item) => item.incidentId === incidentId);
  }

  rollbackIncident(input: {
    incidentId: string;
    actorUserId: string;
    actorRole: UserRole;
    actionType: string;
  }): RollbackActionRecordV2 {
    const incident = this.incidents.get(input.incidentId);
    if (!incident) {
      throw new Error('incident_not_found');
    }
    if (input.actorRole !== 'admin' && input.actorRole !== 'operator') {
      throw new Error('rollback_forbidden');
    }

    incident.status = 'rolling_back';
    incident.updatedAt = new Date().toISOString();
    const action: RollbackActionRecordV2 = {
      id: randomUUID(),
      incidentId: incident.id,
      actorUserId: input.actorUserId,
      actionType: input.actionType,
      status: 'completed',
      result: {
        rolled_back: true
      },
      createdAt: new Date().toISOString()
    };
    this.rollbackActions.set(action.id, action);

    incident.status = 'resolved';
    incident.updatedAt = new Date().toISOString();
    return action;
  }
}

let sharedIncidentService: IncidentServiceV2 | null = null;

export function getSharedIncidentService(): IncidentServiceV2 {
  if (!sharedIncidentService) {
    sharedIncidentService = new IncidentServiceV2();
  }
  return sharedIncidentService;
}
