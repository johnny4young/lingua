import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlDbService } from '../../src/main/sqlDbService';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/me/.ssh/id_rsa'] })) },
}));
vi.mock('../../src/main/runners/ownerReset', () => ({ onOwnerReset: vi.fn(() => () => undefined) }));

const { registerSqlDbHandlers } = await import('../../src/main/ipc/sqlDb');

const event = { sender: { id: 7, isDestroyed: () => false, once: () => undefined } };
const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args));

const draft = { name: 'orders-dev', engine: 'postgres', host: 'db.internal', port: 5432, readOnly: false, passwordMode: 'keychain' };

describe('sql-db IPC handlers', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    handlers.clear();
    service = Object.fromEntries(
      ['catalog', 'save', 'remove', 'openAdhoc', 'sessionPassword', 'test', 'execute', 'fetch', 'cancel', 'closeRun', 'estimate', 'introspect', 'trustHostKey', 'sshInfo', 'releaseOwner'].map((name) => [name, vi.fn(async () => ({ ok: true }))])
    );
    registerSqlDbHandlers(service as unknown as SqlDbService, (file) => (file.includes('/.ssh/') ? 'ssh' : null));
  });

  it('registers every channel', () => {
    expect([...handlers.keys()].sort()).toEqual(
      ['catalog', 'save', 'delete', 'open-adhoc', 'session-password', 'test', 'execute', 'fetch', 'cancel', 'close-run', 'estimate', 'introspect', 'trust-host-key', 'ssh-info', 'pick-file'].map((name) => `sql-db:${name}`).sort()
    );
  });

  it('rejects garbage before it reaches the service', async () => {
    await expect(invoke('sql-db:save', { ...draft, host: 'a b' })).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:save', draft, '../x')).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:execute', 'r1', 'c_1', '', { timeoutMs: 1000 })).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:execute', 'r 1', 'c_1', 'SELECT 1', { timeoutMs: 1000 })).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:execute', 'r1', 'c_1', 'SELECT 1', { timeoutMs: 0 })).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:fetch', 'r1', 1e9, 1)).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:session-password', 'c_1')).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:pick-file', 'anything')).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:catalog', 'extra')).rejects.toThrow('Invalid');
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('passes parsed arguments and the sender as the run owner', async () => {
    await invoke('sql-db:save', { ...draft, password: 'never-stored', extra: true }, undefined, 'pw');
    expect(service.save).toHaveBeenCalledWith({ ...draft, ssl: { mode: 'verify-full' } }, undefined, 'pw', undefined);
    await invoke('sql-db:execute', 'r1', 'c_1', 'SELECT 1', { timeoutMs: 1000, readWrite: { confirmName: 'orders-prod' } });
    expect(service.execute).toHaveBeenCalledWith(7, 'r1', 'c_1', 'SELECT 1', { timeoutMs: 1000, readWrite: { confirmName: 'orders-prod' } });
  });

  it('bounds every field of an introspection request', async () => {
    for (const request of [
      undefined,
      { level: 'tables' },
      { level: 'objects' },
      { level: 'columns', schema: '' },
      { level: 'objects', schema: 'x'.repeat(257) },
      { level: 'detail', schema: 'public', name: 'orders', kind: 'index' },
      { level: 'detail', schema: 'public', kind: 'table' },
      { level: 'detail', schema: 'public', name: 'f', kind: 'function', signature: 'x'.repeat(2049) },
    ]) {
      await expect(invoke('sql-db:introspect', 'c_1', request)).rejects.toThrow('Invalid');
    }
    await expect(invoke('sql-db:introspect', '../c', { level: 'schemas' })).rejects.toThrow('Invalid');
    expect(service.introspect).not.toHaveBeenCalled();
    await invoke('sql-db:introspect', 'c_1', { level: 'detail', schema: 'public', name: 'f', kind: 'function', signature: 'integer', sql: 'DROP TABLE x' });
    expect(service.introspect).toHaveBeenCalledWith('c_1', { level: 'detail', schema: 'public', name: 'f', kind: 'function', signature: 'integer' });
  });

  it('takes the SSH secret and its kind, and bounds host-key trust and SSH lookups', async () => {
    await invoke('sql-db:save', draft, undefined, 'pw', 'ssh-pw');
    expect(service.save).toHaveBeenLastCalledWith(expect.anything(), undefined, 'pw', 'ssh-pw');
    await invoke('sql-db:session-password', 'c_1', 'secret', 'ssh');
    expect(service.sessionPassword).toHaveBeenLastCalledWith('c_1', 'secret', 'ssh');
    await invoke('sql-db:session-password', 'c_1', 'secret');
    expect(service.sessionPassword).toHaveBeenLastCalledWith('c_1', 'secret', 'database');
    await expect(invoke('sql-db:session-password', 'c_1', 'secret', 'root')).rejects.toThrow('Invalid');
    const fingerprint = `SHA256:${'A'.repeat(43)}`;
    await invoke('sql-db:trust-host-key', 'bastion.example.net', 22, fingerprint);
    expect(service.trustHostKey).toHaveBeenCalledWith('bastion.example.net', 22, fingerprint);
    for (const args of [
      ['bastion example', 22, fingerprint],
      ['bastion', 0, fingerprint],
      ['bastion', 22, 'MD5:aa:bb'],
      ['bastion', 22, `SHA256:${'A'.repeat(42)}`],
    ]) {
      await expect(invoke('sql-db:trust-host-key', ...args)).rejects.toThrow('Invalid');
    }
    await expect(invoke('sql-db:ssh-info', '../../etc/passwd')).rejects.toThrow('Invalid');
    await invoke('sql-db:ssh-info', 'bastion');
    expect(service.sshInfo).toHaveBeenCalledWith('bastion');
  });

  it('refuses a picked file in a protected folder', async () => {
    expect(await invoke('sql-db:pick-file', 'key')).toEqual({ canceled: true, blocked: true });
  });
});
