import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const { hostEnvironment } = await import('../../src/main/sqlHostProcess');

describe('hostEnvironment', () => {
  it('drops database client settings so no driver reads a password or host from them', () => {
    const env = hostEnvironment({ PATH: '/usr/bin', HOME: '/home/u', PGPASSWORD: 'x', PGPASSFILE: '/p', PGHOST: 'h', MYSQL_PWD: 'y', pghost: 'z' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
  });
});
