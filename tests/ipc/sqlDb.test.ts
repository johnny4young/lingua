import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlDbService } from '../../src/main/sqlDbService';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/me/.ssh/id_rsa'] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));
vi.mock('../../src/main/runners/ownerReset', () => ({ onOwnerReset: vi.fn(() => () => undefined) }));

const { registerSqlDbHandlers } = await import('../../src/main/ipc/sqlDb');
const { dialog } = await import('electron');
const { mintRootCapability } = await import('../../src/main/ipc/projectCapabilities');

const event = { sender: { id: 7, isDestroyed: () => false, once: () => undefined } };
const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args));

const draft = { name: 'orders-dev', engine: 'postgres', host: 'db.internal', port: 5432, readOnly: false, passwordMode: 'keychain' };

describe('sql-db IPC handlers', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    handlers.clear();
    service = Object.fromEntries(
      ['catalog', 'save', 'remove', 'openAdhoc', 'sessionPassword', 'test', 'execute', 'fetch', 'cancel', 'closeRun', 'estimate', 'introspect', 'trustHostKey', 'sshInfo', 'releaseOwner', 'chooseSshKey', 'exportCatalog', 'offerImportedTunnels', 'applyEdits'].map((name) => [name, vi.fn(async () => ({ ok: true }))])
    );
    registerSqlDbHandlers(service as unknown as SqlDbService, (file) => (file.includes('/.ssh/') ? 'ssh' : null));
  });

  it('registers every channel', () => {
    expect([...handlers.keys()].sort()).toEqual(
      ['catalog', 'save', 'delete', 'open-adhoc', 'session-password', 'test', 'execute', 'fetch', 'cancel', 'close-run', 'estimate', 'introspect', 'trust-host-key', 'ssh-info', 'pick-file', 'import-file', 'import-env', 'export', 'apply-edits'].map((name) => `sql-db:${name}`).sort()
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

  it('passes a parsed change set for staged edits and refuses anything else', async () => {
    const changes = { updates: [{ key: { id: '1' }, values: { city: null } }], deletes: [], inserts: [] };
    await invoke('sql-db:apply-edits', 'c_1', { schema: 'public', name: 'orders', extra: 1 }, { ...changes, sql: 'DROP TABLE x' }, 'orders-prod');
    expect(service.applyEdits).toHaveBeenCalledWith('c_1', { schema: 'public', name: 'orders' }, changes, 'orders-prod');
    for (const bad of [
      { ...changes, updates: [{ key: { id: 1 }, values: {} }] },
      { ...changes, updates: [{ key: JSON.parse('{"__proto__": "x"}'), values: {} }] },
      { ...changes, deletes: Array.from({ length: 1001 }, () => ({ key: { id: '1' } })) },
      { updates: [], deletes: Array.from({ length: 600 }, () => ({ key: { id: '1' } })), inserts: Array.from({ length: 401 }, () => ({ values: {} })) },
      { updates: [], deletes: [], inserts: Array.from({ length: 17 }, () => ({ values: { note: 'x'.repeat(1024 * 1024) } })) },
      { updates: [], deletes: [] },
      null,
    ]) {
      await expect(invoke('sql-db:apply-edits', 'c_1', { schema: 'public', name: 'orders' }, bad)).rejects.toThrow('Invalid');
    }
    await expect(invoke('sql-db:apply-edits', 'c_1', { schema: '', name: 'orders' }, changes)).rejects.toThrow('Invalid');
    await expect(invoke('sql-db:apply-edits', '../c', { schema: 'public', name: 'orders' }, changes)).rejects.toThrow('Invalid');
    expect(service.applyEdits).toHaveBeenCalledTimes(1);
  });

  it('refuses a picked file in a protected folder', async () => {
    expect(await invoke('sql-db:pick-file', 'key')).toEqual({ canceled: true, blocked: true });
  });

  describe('imports and export', () => {
    let dir: string;
    beforeEach(() => {
      // The project sandbox refuses temp folders as roots, as the file-system tests note.
      dir = mkdtempSync(path.join(process.cwd(), '.tmp-lingua-sqlimport-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads the picked client file without passwords, and offers only its exact tunnels for their keys', async () => {
      await expect(invoke('sql-db:import-file', 'navicat')).rejects.toThrow('Invalid');
      const file = path.join(dir, 'data-sources.json');
      const keyPath = path.join(dir, 'id_ed25519');
      writeFileSync(
        file,
        JSON.stringify({
          connections: {
            a: {
              provider: 'postgresql',
              name: 'Shop',
              configuration: { host: 'db', user: 'app', password: 'never-read', handlers: { ssh_tunnel: { enabled: true, user: 'u', properties: { host: 'b', authType: 'PUBLIC_KEY', keyPath } } } },
            },
          },
        })
      );
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [file] });
      const result = await invoke('sql-db:import-file', 'dbeaver');
      expect(result).toMatchObject({ canceled: false, skipped: 0, found: [{ draft: { name: 'Shop', host: 'db', user: 'app', ssh: { keyPath } } }] });
      expect(JSON.stringify(result)).not.toContain('never-read');
      expect(service.chooseSshKey).not.toHaveBeenCalled();
      expect(service.offerImportedTunnels).toHaveBeenCalledWith([expect.objectContaining({ host: 'b', user: 'u', keyPath })]);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/me/.ssh/config'] });
      expect(await invoke('sql-db:import-file', 'dbeaver')).toEqual({ canceled: false, found: [], skipped: 0, error: 'unreadable' });
    });

    it('scans only the open project root for .env database URLs', async () => {
      writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://app:s3cret@db.internal/orders\n');
      writeFileSync(path.join(dir, '.env.production'), 'POSTGRES_URL=postgres://app@prod.internal/orders\n');
      const { rootId } = mintRootCapability(dir);
      const result = await invoke('sql-db:import-env', rootId);
      expect(result).toMatchObject({ canceled: false, skipped: 0, found: [{ draft: { host: 'db.internal' } }, { draft: { host: 'prod.internal', env: 'prod' } }] });
      expect(JSON.stringify(result)).not.toContain('s3cret');
      expect(await invoke('sql-db:import-env', 'not-a-root')).toMatchObject({ error: 'unreadable' });
      await expect(invoke('sql-db:import-env', '')).rejects.toThrow('Invalid');
    });

    it('writes the export where the user chose, private to the user, and never into a protected folder', async () => {
      service.exportCatalog!.mockResolvedValue({ text: '{"format":"lingua.sql-connections"}\n', count: 2 });
      const target = path.join(dir, 'out.json');
      // An existing file the user overwrites becomes private too.
      writeFileSync(target, 'old', { mode: 0o644 });
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target });
      expect(await invoke('sql-db:export')).toEqual({ canceled: false, ok: true, count: 2 });
      expect(readFileSync(target, 'utf-8')).toContain('lingua.sql-connections');
      if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600);
      const protectedFolder = path.join(dir, '.ssh');
      mkdirSync(protectedFolder);
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: path.join(protectedFolder, 'out.json') });
      expect(await invoke('sql-db:export')).toEqual({ canceled: false, ok: false, count: 2 });
      expect(existsSync(path.join(protectedFolder, 'out.json'))).toBe(false);
      const elsewhere = path.join(dir, 'elsewhere.json');
      writeFileSync(elsewhere, 'keep');
      symlinkSync(elsewhere, path.join(dir, 'link.json'));
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: path.join(dir, 'link.json') });
      expect(await invoke('sql-db:export')).toEqual({ canceled: false, ok: false, count: 2 });
      expect(readFileSync(elsewhere, 'utf-8')).toBe('keep');
      await expect(invoke('sql-db:export', 'extra')).rejects.toThrow('Invalid');
    });
  });
});
