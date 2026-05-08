import { generateDeviceId, DeviceManager } from '../device-manager';

describe('generateDeviceId', () => {
  it('should return a DeviceInfo with valid deviceId (64-char hex)', () => {
    const info = generateDeviceId();
    expect(info.deviceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return a deviceIdShort that is the first 12 chars of deviceId', () => {
    const info = generateDeviceId();
    expect(info.deviceIdShort).toHaveLength(12);
    expect(info.deviceIdShort).toBe(info.deviceId.substring(0, 12));
  });

  it('should include hostname and platform', () => {
    const info = generateDeviceId();
    expect(typeof info.hostname).toBe('string');
    expect(info.hostname.length).toBeGreaterThan(0);
    expect(typeof info.platform).toBe('string');
  });

  it('should include a valid ISO firstSeen timestamp', () => {
    const info = generateDeviceId();
    const date = new Date(info.firstSeen);
    expect(date.getTime()).not.toBeNaN();
  });
});

describe('DeviceManager', () => {
  function createMockStore(initial: Record<string, any> = {}) {
    const data: Record<string, any> = { ...initial };
    return {
      get: (key: string) => data[key],
      set: (key: string, value: any) => { data[key] = value; },
      _data: data,
    };
  }

  it('should generate and persist deviceInfo on first call', () => {
    const store = createMockStore();
    const dm = new DeviceManager(store);

    const info = dm.getOrCreateDeviceId();
    expect(info.deviceId).toMatch(/^[a-f0-9]{64}$/);
    expect(info.deviceIdShort).toHaveLength(12);
    expect(store._data['deviceInfo']).toEqual(info);
  });

  it('should return existing deviceInfo from store without regenerating', () => {
    const existing = {
      deviceId: 'a'.repeat(64),
      deviceIdShort: 'a'.repeat(12),
      hostname: 'test-host',
      platform: 'win32',
      firstSeen: '2024-01-01T00:00:00.000Z',
    };
    const store = createMockStore({ deviceInfo: existing });
    const dm = new DeviceManager(store);

    const info = dm.getOrCreateDeviceId();
    expect(info).toEqual(existing);
  });

  it('should regenerate if stored deviceInfo is missing deviceId', () => {
    const store = createMockStore({ deviceInfo: { deviceIdShort: 'abc' } });
    const dm = new DeviceManager(store);

    const info = dm.getOrCreateDeviceId();
    expect(info.deviceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('getDeviceIdShort should return the short id', () => {
    const store = createMockStore();
    const dm = new DeviceManager(store);

    const short = dm.getDeviceIdShort();
    expect(short).toHaveLength(12);
    expect(short).toMatch(/^[a-f0-9]{12}$/);
  });

  it('getDeviceInfo should return full DeviceInfo', () => {
    const store = createMockStore();
    const dm = new DeviceManager(store);

    const info = dm.getDeviceInfo();
    expect(info.deviceId).toMatch(/^[a-f0-9]{64}$/);
    expect(info.deviceIdShort).toBe(info.deviceId.substring(0, 12));
    expect(info.hostname).toBeTruthy();
    expect(info.platform).toBeTruthy();
    expect(info.firstSeen).toBeTruthy();
  });
});
