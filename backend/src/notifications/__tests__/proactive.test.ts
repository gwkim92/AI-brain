import { describe, expect, it } from 'vitest';

import type { JarvisStore } from '../../store/types';
import { createNotificationService } from '../proactive';

describe('notification service', () => {
  it('suppresses duplicate notifications within dedupe window', () => {
    const service = createNotificationService();
    const received: string[] = [];
    service.subscribe((event) => {
      received.push(event.type);
    });

    service.emitMissionStepCompleted('mission-1', 'step-1');
    service.emitMissionStepCompleted('mission-1', 'step-1');

    expect(received).toEqual(['mission_step_completed']);
    expect(service.getRuntimeStatus().suppressed).toBe(1);
  });

  it('emits idle reminders and exposes runtime status', async () => {
    const service = createNotificationService();
    const received: string[] = [];
    service.subscribe((event) => {
      received.push(event.type);
    });

    const store = {
      listMissions: async () => [{ id: 'm-1' }]
    } as unknown as JarvisStore;

    await service.checkIdleReminder(store, 'user-1');

    expect(received).toEqual(['idle_reminder']);
    const status = service.getRuntimeStatus();
    expect(status.listeners).toBe(1);
    expect(status.emitted).toBe(1);
    expect(status.lastEventAt).not.toBeNull();
  });
});
