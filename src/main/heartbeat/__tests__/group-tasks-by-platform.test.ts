import type { HeartbeatTask, PlatformGroup } from '../types';

// Mock the heavy dependency chain to avoid ESM issues with uuid
jest.mock('../../pi-agent-manager', () => ({
  PiAgentManager: jest.fn(),
}));

import { HeartbeatManager } from '../heartbeat-manager';

function makeTask(overrides: Partial<HeartbeatTask> & { id: string }): HeartbeatTask {
  return {
    skill: 'test-skill',
    platform: 'meituan',
    cron: '*/1 * * * *',
    enabled: true,
    scheduleType: 'interval',
    scheduleConfig: { value: 1, unit: 'minutes' },
    ...overrides,
  };
}

describe('HeartbeatManager.groupTasksByPlatform', () => {
  let manager: HeartbeatManager;

  beforeEach(() => {
    manager = new HeartbeatManager({} as any, {} as any, '/dev/null');
  });

  it('should group enabled tasks by platform', () => {
    const tasks: HeartbeatTask[] = [
      makeTask({ id: 'a', platform: 'meituan' }),
      makeTask({ id: 'b', platform: 'ctrip' }),
      makeTask({ id: 'c', platform: 'meituan' }),
    ];

    const groups = manager.groupTasksByPlatform(tasks);

    expect(groups).toHaveLength(2);
    const meituan = groups.find(g => g.platform === 'meituan')!;
    const ctrip = groups.find(g => g.platform === 'ctrip')!;
    expect(meituan.tasks).toHaveLength(2);
    expect(meituan.tasks.map(t => t.id)).toEqual(['a', 'c']);
    expect(ctrip.tasks).toHaveLength(1);
    expect(ctrip.tasks[0].id).toBe('b');
  });

  it('should filter out disabled tasks', () => {
    const tasks: HeartbeatTask[] = [
      makeTask({ id: 'a', platform: 'meituan', enabled: true }),
      makeTask({ id: 'b', platform: 'meituan', enabled: false }),
      makeTask({ id: 'c', platform: 'ctrip', enabled: false }),
    ];

    const groups = manager.groupTasksByPlatform(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0].platform).toBe('meituan');
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[0].tasks[0].id).toBe('a');
  });

  it('should return empty array when all tasks are disabled', () => {
    const tasks: HeartbeatTask[] = [
      makeTask({ id: 'a', enabled: false }),
      makeTask({ id: 'b', enabled: false }),
    ];

    expect(manager.groupTasksByPlatform(tasks)).toEqual([]);
  });

  it('should return empty array for empty input', () => {
    expect(manager.groupTasksByPlatform([])).toEqual([]);
  });

  it('should use task.id as platform for tasks without platform field (backward compat)', () => {
    const taskWithoutPlatform = {
      id: 'legacy-task',
      skill: 'room-status',
      cron: '*/1 * * * *',
      enabled: true,
    } as HeartbeatTask;

    const groups = manager.groupTasksByPlatform([taskWithoutPlatform]);

    expect(groups).toHaveLength(1);
    expect(groups[0].platform).toBe('legacy-task');
    expect(groups[0].tasks).toHaveLength(1);
  });

  it('should handle mix of tasks with and without platform field', () => {
    const tasks = [
      makeTask({ id: 'new-task', platform: 'meituan' }),
      { id: 'old-task', skill: 'test', cron: '*/1 * * * *', enabled: true } as HeartbeatTask,
    ];

    const groups = manager.groupTasksByPlatform(tasks);

    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.platform === 'meituan')).toBeDefined();
    expect(groups.find(g => g.platform === 'old-task')).toBeDefined();
  });
});
