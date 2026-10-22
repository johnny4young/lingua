/**
 * `sql-db:*` IPC over the desktop database client. Every argument is parsed
 * here before the service sees it: ids against the catalog charset, drafts
 * through the strict connection parser, SQL and passwords against size caps.
 */

import { BrowserWindow, dialog } from 'electron';
import { isValidConnectionId, parseConnectionDraft, type SqlConnectionDraft } from '../../shared/sqlConnections';
import { SQL_DB_OBJECT_KINDS, type SqlDbFileKind, type SqlDbIntrospect, type SqlDbObjectKind, type SqlDbRunOptions, type SqlDbTarget } from '../../shared/sqlDb';
import { MAX_QUERY_BYTES, MAX_QUERY_TIMEOUT_MS } from '../../shared/sqlWorkspace';
import { onOwnerReset } from '../runners/ownerReset';
import type { SqlDbService } from '../sqlDbService';
import { validatedHandle } from './typedHandle';

const MAX_PASSWORD = 4096;
const MAX_PAGE_ROWS = 10_000;
const MAX_PAGE_BYTES = 64 * 1024 * 1024;

const fail = (channel: string): never => {
  throw new Error(`Invalid ${channel} arguments`);
};

const connectionId = (value: unknown, channel: string): string => (isValidConnectionId(value) ? value : fail(channel));

const runId = (value: unknown, channel: string): string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : fail(channel);

const secret = (value: unknown, channel: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value.length <= MAX_PASSWORD ? value : fail(channel);
};

const draft = (value: unknown, channel: string): SqlConnectionDraft => parseConnectionDraft(value) ?? fail(channel);

const sql = (value: unknown, channel: string): string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= MAX_QUERY_BYTES ? value : fail(channel);

const count = (value: unknown, max: number, channel: string): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : fail(channel);

function target(value: unknown, channel: string): SqlDbTarget {
  if (!value || typeof value !== 'object') return fail(channel);
  const record = value as Record<string, unknown>;
  if ('connectionId' in record) return { connectionId: connectionId(record.connectionId, channel) };
  const password = secret(record.password, channel);
  return { draft: draft(record.draft, channel), ...(password !== undefined ? { password } : {}) };
}

function runOptions(value: unknown, channel: string): SqlDbRunOptions {
  if (!value || typeof value !== 'object') return fail(channel);
  const record = value as Record<string, unknown>;
  const timeoutMs = count(record.timeoutMs, MAX_QUERY_TIMEOUT_MS, channel);
  if (record.readWrite === undefined) return { timeoutMs };
  const readWrite = record.readWrite as Record<string, unknown> | null;
  if (!readWrite || typeof readWrite.confirmName !== 'string' || readWrite.confirmName.length > 200) return fail(channel);
  return { timeoutMs, readWrite: { confirmName: readWrite.confirmName } };
}

const MAX_NAME = 256;
const MAX_SIGNATURE = 2048;

const bounded = (value: unknown, max: number, channel: string): string =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail(channel);

function introspection(value: unknown, channel: string): SqlDbIntrospect {
  if (!value || typeof value !== 'object') return fail(channel);
  const record = value as Record<string, unknown>;
  switch (record.level) {
    case 'schemas':
      return { level: 'schemas' };
    case 'objects':
    case 'columns':
      return { level: record.level, schema: bounded(record.schema, MAX_NAME, channel) };
    case 'detail': {
      const kind = SQL_DB_OBJECT_KINDS.includes(record.kind as SqlDbObjectKind) ? (record.kind as SqlDbObjectKind) : fail(channel);
      const signature = record.signature === undefined ? undefined : typeof record.signature === 'string' && record.signature.length <= MAX_SIGNATURE ? record.signature : fail(channel);
      return {
        level: 'detail',
        schema: bounded(record.schema, MAX_NAME, channel),
        name: bounded(record.name, MAX_NAME, channel),
        kind,
        ...(signature !== undefined ? { signature } : {}),
      };
    }
    default:
      return fail(channel);
  }
}

const FILE_FILTERS: Readonly<Record<SqlDbFileKind, Electron.FileFilter[]>> = {
  sqlite: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: '*', extensions: ['*'] }],
  ca: [{ name: 'PEM', extensions: ['pem', 'crt', 'cer'] }, { name: '*', extensions: ['*'] }],
  cert: [{ name: 'PEM', extensions: ['pem', 'crt', 'cer'] }, { name: '*', extensions: ['*'] }],
  key: [{ name: 'PEM', extensions: ['pem', 'key'] }, { name: '*', extensions: ['*'] }],
};

export function registerSqlDbHandlers(service: SqlDbService, blockedPath: (filePath: string) => string | null): void {
  const watched = new Set<number>();
  // Runs belong to the renderer that started them and end with it.
  const own = (sender: Electron.WebContents): number => {
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      const id = sender.id;
      onOwnerReset(sender, () => {
        watched.delete(id);
        service.releaseOwner(id);
      });
    }
    return sender.id;
  };

  validatedHandle('sql-db:catalog', (args) => (args.length === 0 ? ([] as []) : fail('sql-db:catalog')), () => service.catalog());

  validatedHandle(
    'sql-db:save',
    (args) => {
      const id = args[1] === undefined || args[1] === null ? undefined : connectionId(args[1], 'sql-db:save');
      return [draft(args[0], 'sql-db:save'), id, secret(args[2], 'sql-db:save')] as [SqlConnectionDraft, string | undefined, string | undefined];
    },
    (_event, value, id, password) => service.save(value, id, password)
  );

  validatedHandle('sql-db:delete', (args) => [connectionId(args[0], 'sql-db:delete')] as [string], (_event, id) => service.remove(id));

  validatedHandle(
    'sql-db:open-adhoc',
    (args) => [draft(args[0], 'sql-db:open-adhoc'), secret(args[1], 'sql-db:open-adhoc')] as [SqlConnectionDraft, string | undefined],
    (_event, value, password) => service.openAdhoc(value, password)
  );

  validatedHandle(
    'sql-db:session-password',
    (args) => [connectionId(args[0], 'sql-db:session-password'), secret(args[1], 'sql-db:session-password') ?? fail('sql-db:session-password')] as [string, string],
    (_event, id, password) => service.sessionPassword(id, password)
  );

  validatedHandle('sql-db:test', (args) => [target(args[0], 'sql-db:test')] as [SqlDbTarget], (_event, value) => service.test(value));

  validatedHandle(
    'sql-db:execute',
    (args) =>
      [runId(args[0], 'sql-db:execute'), connectionId(args[1], 'sql-db:execute'), sql(args[2], 'sql-db:execute'), runOptions(args[3], 'sql-db:execute')] as [
        string,
        string,
        string,
        SqlDbRunOptions,
      ],
    (event, run, id, statement, options) => service.execute(own(event.sender), run, id, statement, options)
  );

  validatedHandle(
    'sql-db:fetch',
    (args) => [runId(args[0], 'sql-db:fetch'), count(args[1], MAX_PAGE_ROWS, 'sql-db:fetch'), count(args[2], MAX_PAGE_BYTES, 'sql-db:fetch')] as [string, number, number],
    (event, run, limit, maxBytes) => service.fetch(own(event.sender), run, limit, maxBytes)
  );

  validatedHandle('sql-db:cancel', (args) => [runId(args[0], 'sql-db:cancel')] as [string], (event, run) => service.cancel(own(event.sender), run));

  validatedHandle(
    'sql-db:close-run',
    (args) => [runId(args[0], 'sql-db:close-run')] as [string],
    async (event, run) => {
      await service.closeRun(own(event.sender), run);
      return { ok: true };
    }
  );

  validatedHandle(
    'sql-db:estimate',
    (args) => [connectionId(args[0], 'sql-db:estimate'), sql(args[1], 'sql-db:estimate')] as [string, string],
    (_event, id, statement) => service.estimate(id, statement)
  );

  validatedHandle(
    'sql-db:introspect',
    (args) => [connectionId(args[0], 'sql-db:introspect'), introspection(args[1], 'sql-db:introspect')] as [string, SqlDbIntrospect],
    (_event, id, request) => service.introspect(id, request)
  );

  validatedHandle(
    'sql-db:pick-file',
    (args) => {
      const kind = args[0];
      return kind === 'sqlite' || kind === 'ca' || kind === 'cert' || kind === 'key' ? ([kind] as [SqlDbFileKind]) : fail('sql-db:pick-file');
    },
    async (event, kind) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: FILE_FILTERS[kind] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const chosen = picked.filePaths[0];
      if (picked.canceled || !chosen) return { canceled: true } as const;
      if (blockedPath(chosen)) return { canceled: true, blocked: true } as const;
      return { canceled: false, path: chosen } as const;
    }
  );
}
