import { describe, expect, it } from 'vitest';

import { IncidentServiceV2 } from '../service';

describe('IncidentServiceV2', () => {
  it('rejects rollback for non-operator roles', () => {
    const service = new IncidentServiceV2();
    const incident = service.createIncident({
      incidentType: 'policy_error',
      severity: 'high',
      summary: 'policy denied safe action'
    });

    expect(() =>
      service.rollbackIncident({
        incidentId: incident.id,
        actorUserId: '00000000-0000-4000-8000-000000000001',
        actorRole: 'member',
        actionType: 'policy_rollback'
      })
    ).toThrow('rollback_forbidden');
  });

  it('allows rollback for operator/admin roles', () => {
    const service = new IncidentServiceV2();
    const incident = service.createIncident({
      incidentType: 'connector_outage',
      severity: 'critical',
      summary: 'connector is down'
    });

    const action = service.rollbackIncident({
      incidentId: incident.id,
      actorUserId: '00000000-0000-4000-8000-000000000001',
      actorRole: 'operator',
      actionType: 'connector_disable'
    });

    expect(action.status).toBe('completed');
    expect(service.listRollbackActions(incident.id).length).toBe(1);
  });
});
