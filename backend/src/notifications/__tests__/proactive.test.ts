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

  it('tracks notification channel delivery metrics', async () => {
    let delivered = 0;
    const service = createNotificationService({
      channels: [
        {
          name: 'test-webhook',
          send: async () => {
            delivered += 1;
          }
        },
        {
          name: 'failing-webhook',
          send: async () => {
            throw new Error('delivery failed');
          }
        }
      ]
    });

    service.emitRadarNewItem(3);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = service.getRuntimeStatus();
    const successChannel = status.channels.find((item) => item.name === 'test-webhook');
    const failureChannel = status.channels.find((item) => item.name === 'failing-webhook');

    expect(delivered).toBe(1);
    expect(successChannel?.sent).toBe(1);
    expect(successChannel?.failed).toBe(0);
    expect(failureChannel?.sent).toBe(0);
    expect(failureChannel?.failed).toBe(1);
    expect(failureChannel?.lastError).toContain('delivery failed');
  });
});
