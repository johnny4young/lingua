import { describe, expect, it } from 'vitest';
import { createHost, inProcessTransport } from '@electron-stagewright/host-supervisor';
import { reviveSqlHostError, SQL_HOST_ERROR_DETAIL, SqlHostError } from '../../../src/main/sqlHost/hostError';

interface Ops {
  fail(kind: string): Promise<null>;
}

function supervised() {
  return createHost<Ops>({
    operations: ['fail'],
    transport: inProcessTransport<Ops>({
      operations: ['fail'],
      errors: SQL_HOST_ERROR_DETAIL,
      start: () => ({
        fail: async kind => {
          if (kind === 'detail') throw new SqlHostError({ message: 'host key changed', step: 'ssh', fix: 'ssh-host-key', hostKey: { host: 'bastion', port: 22, fingerprint: 'SHA256:x', type: 'ssh-ed25519' } });
          if (kind === 'code') throw new SqlHostError({ message: 'gone', code: 'engine-gone' });
          throw new TypeError('plain');
        },
      }),
    }),
    errors: { revive: reviveSqlHostError },
  });
}

describe('SQL host errors across the supervisor', () => {
  it('keeps the whole detail, lowercase codes included, and leaves other errors plain', async () => {
    const host = supervised();
    await expect(host.call('fail', ['detail'])).rejects.toMatchObject({
      name: 'SqlHostError',
      detail: { message: 'host key changed', step: 'ssh', fix: 'ssh-host-key', hostKey: { host: 'bastion', fingerprint: 'SHA256:x' } },
    });
    await expect(host.call('fail', ['code'])).rejects.toBeInstanceOf(SqlHostError);
    await expect(host.call('fail', ['code'])).rejects.toMatchObject({ detail: { code: 'engine-gone' } });
    const plain = await host.call('fail', ['plain']).catch((error: unknown) => error);
    expect(plain).not.toBeInstanceOf(SqlHostError);
    expect(plain).toMatchObject({ message: 'plain' });
    await host.close();
  });
});
