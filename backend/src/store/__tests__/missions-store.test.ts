import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../memory-store';

describe('mission store contract', () => {
  it('creates mission and reads it by id/list', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const mission = await store.createMission({
      userId: 'user-default',
      title: 'Studio migration',
      objective: 'Split studio routes and keep mission runtime unified',
      domain: 'code',
      status: 'draft',
      steps: [
        {
          id: 'a4f95f16-6320-46c6-ac58-8f285e1e4ba1',
          type: 'code',
          title: 'Define routes',
          description: 'Create studio routes',
          route: '/studio/code',
          status: 'pending',
          order: 2
        },
        {
          id: '1e4f2c06-c3e8-4185-90e7-0d4f1623cb80',
          type: 'execute',
          title: 'Review mission state',
          description: 'Check mission board',
          route: '/mission',
          status: 'pending',
          order: 1
        }
      ]
    });

    expect(mission.id).toBeTruthy();
    expect(mission.steps.length).toBe(2);
    expect(mission.steps[0]?.title).toBe('Review mission state');
    expect(mission.steps[1]?.title).toBe('Define routes');

    const listed = await store.listMissions({
      userId: 'user-default',
      limit: 10
    });

    expect(listed.length).toBe(1);
    expect(listed[0]?.id).toBe(mission.id);

    const detail = await store.getMissionById({
      missionId: mission.id,
      userId: 'user-default'
    });

    expect(detail?.id).toBe(mission.id);
    expect(detail?.title).toBe('Studio migration');
  });

  it('filters missions by user and status', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    await store.createMission({
      userId: 'user-default',
      title: 'Mission A',
      objective: 'A',
      domain: 'mixed',
      status: 'running',
      steps: [
        {
          id: 'fd8f2eb3-1f93-43e2-a960-2f0724be8c40',
          type: 'execute',
          title: 'Run',
          description: 'Run',
          route: '/mission',
          status: 'pending',
          order: 1
        }
      ]
    });

    await store.createMission({
      userId: 'another-user',
      title: 'Mission B',
      objective: 'B',
      domain: 'research',
      status: 'draft',
      steps: [
        {
          id: '5eb43f0e-cf31-49fd-bc0a-91f0eeb83887',
          type: 'research',
          title: 'Research',
          description: 'Research',
          route: '/studio/research',
          status: 'pending',
          order: 1
        }
      ]
    });

    const running = await store.listMissions({
      userId: 'user-default',
      status: 'running',
      limit: 10
    });

    expect(running.length).toBe(1);
    expect(running[0]?.title).toBe('Mission A');

    const wrongUserDetail = await store.getMissionById({
      missionId: running[0]!.id,
      userId: 'another-user'
    });

    expect(wrongUserDetail).toBeNull();
  });

  it('updates mission status and step status', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const mission = await store.createMission({
      userId: 'user-default',
      title: 'Mission status update',
      objective: 'Update mission and step states',
      domain: 'mixed',
      status: 'draft',
      steps: [
        {
          id: 'bf65adf1-f2a0-4f41-8a32-5ba65176368f',
          type: 'execute',
          title: 'Execute',
          description: 'Execute work',
          route: '/mission',
          status: 'pending',
          order: 1
        }
      ]
    });

    const updated = await store.updateMission({
      missionId: mission.id,
      userId: 'user-default',
      status: 'running',
      stepStatuses: [
        {
          stepId: mission.steps[0]!.id,
          status: 'running'
        }
      ]
    });

    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('running');
    expect(updated?.steps[0]?.status).toBe('running');
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(mission.updatedAt).getTime());
  });
});
