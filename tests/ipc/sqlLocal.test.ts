import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlLocalService } from '../../src/main/sqlLocal/service';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}));
const resets: Array<() => void> = [];
vi.mock('../../src/main/runners/ownerReset', () => ({
  onOwnerReset: vi.fn((_owner: unknown, reset: () => void) => {
    resets.push(reset);
    return () => undefined;
  }),
}));

const { registerSqlLocalHandlers } = await import('../../src/main/ipc/sqlLocal');

const event = { sender: { id: 7 } };
const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args));
const id = '0b0e6c1a-6b8f-4f4e-9d56-2f0d1f8f6c11';

describe('sql-local IPC handlers', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    handlers.clear();
    resets.length = 0;
    service = Object.fromEntries(
      ['status', 'open', 'connect', 'query', 'stream', 'next', 'cancel', 'closeConnection', 'registerFile', 'registerEmptyFile', 'dropFile', 'readFile', 'terminate', 'clearDatabase', 'databaseBytes', 'releaseOwner'].map(name => [
        name,
        vi.fn(async () => ({ ok: true, value: null })),
      ])
    );
    registerSqlLocalHandlers(service as unknown as SqlLocalService);
  });

  it('registers every channel of the contract', () => {
    expect([...handlers.keys()].sort()).toEqual(
      ['status', 'open', 'connect', 'query', 'stream', 'next', 'cancel', 'close-connection', 'register-file', 'register-empty-file', 'drop-file', 'read-file', 'terminate', 'clear-database', 'database-bytes']
        .map(name => `sql-local:${name}`)
        .sort()
    );
  });

  it('rejects garbage before it reaches the engine', async () => {
    const refused: Array<[string, ...unknown[]]> = [
      ['sql-local:open', 'yes'],
      ['sql-local:connect', '../engine'],
      ['sql-local:query', id, ''],
      ['sql-local:query', id, 'x'.repeat(4 * 1024 * 1024 + 1)],
      ['sql-local:query', 'not-an-id', 'SELECT 1'],
      ['sql-local:next', 42],
      ['sql-local:register-file', id, '../escape.csv', new Uint8Array(1)],
      ['sql-local:register-file', id, 'lingua_import_a.exe', new Uint8Array(1)],
      ['sql-local:register-file', id, 'lingua_import_a.csv', 'text'],
      ['sql-local:register-file', id, 'lingua_import_a.csv', new Uint8Array(256 * 1024 * 1024 + 1)],
      ['sql-local:read-file', id, '/etc/hosts'],
      ['sql-local:drop-file', id, 'notes.csv'],
      ['sql-local:terminate', id, 'force'],
      ['sql-local:status', 'extra'],
      ['sql-local:clear-database', 'all'],
    ];
    for (const [channel, ...args] of refused) await expect(invoke(channel, ...args), channel).rejects.toThrow('Invalid');
    expect(Object.values(service).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });

  it('passes the sender as the owner and releases its engine when the document resets', async () => {
    await invoke('sql-local:open', true);
    expect(service.open).toHaveBeenCalledWith(7, true);
    await invoke('sql-local:query', id, 'SELECT 1');
    expect(service.query).toHaveBeenCalledWith(7, id, 'SELECT 1');
    await invoke('sql-local:register-file', id, 'lingua_import_9f8e.csv', new Uint8Array([1, 2]));
    expect(service.registerFile).toHaveBeenCalledWith(7, id, 'lingua_import_9f8e.csv', new Uint8Array([1, 2]));
    expect(resets).toHaveLength(1);
    resets[0]!();
    expect(service.releaseOwner).toHaveBeenCalledWith(7);
  });
});
