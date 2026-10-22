/**
 * `sql-db:*` IPC over the desktop database client. Every argument is parsed
 * here before the service sees it: ids against the catalog charset, drafts
 * through the strict connection parser, SQL and passwords against size caps.
 */

import { realpathSync } from 'node:fs';
import { chmod, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { isValidConnectionId, parseConnectionDraft, type SqlConnectionDraft } from '../../shared/sqlConnections';
import { isSshFolderFile } from '../sqlSsh/sshKeyPath';
import { readSmallFile } from '../sqlSsh/sshTargets';
import { checkedCandidates, importCandidates, MAX_IMPORT_BYTES, siblingFile } from '../sqlImport';
import { isClientFile } from '../sqlImport/clientFiles';
import { ENV_FILES, envCandidates } from '../sqlImport/envFile';
import { resolveCapabilityPath } from './projectCapabilities';
import { SQL_DB_IMPORT_SOURCES, SQL_DB_OBJECT_KINDS, type SqlDbImportCandidate, type SqlDbImportSource, type SqlDbSecretKind, type SqlDbFileKind, type SqlDbIntrospect, type SqlDbObjectKind, type SqlDbRunOptions, type SqlDbTarget } from '../../shared/sqlDb';
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

const hostName = (value: unknown, channel: string): string =>
  typeof value === 'string' && value.length <= 253 && /^[A-Za-z0-9._:%-]+$/.test(value) ? value : fail(channel);

const port = (value: unknown, channel: string): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : fail(channel);

const fingerprint = (value: unknown, channel: string): string =>
  typeof value === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(value) ? value : fail(channel);

const sql = (value: unknown, channel: string): string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= MAX_QUERY_BYTES ? value : fail(channel);

const count = (value: unknown, max: number, channel: string): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : fail(channel);

function target(value: unknown, channel: string): SqlDbTarget {
  if (!value || typeof value !== 'object') return fail(channel);
  const record = value as Record<string, unknown>;
  if ('connectionId' in record) return { connectionId: connectionId(record.connectionId, channel) };
  const password = secret(record.password, channel);
  const sshPassword = secret(record.sshPassword, channel);
  return { draft: draft(record.draft, channel), ...(password !== undefined ? { password } : {}), ...(sshPassword !== undefined ? { sshPassword } : {}) };
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
  'ssh-key': [{ name: '*', extensions: ['*'] }],
};

const IMPORT_FILTERS: Readonly<Record<SqlDbImportSource, Electron.FileFilter[]>> = {
  tableplus: [{ name: 'TablePlus', extensions: ['plist'] }, { name: '*', extensions: ['*'] }],
  dbeaver: [{ name: 'DBeaver', extensions: ['json'] }, { name: '*', extensions: ['*'] }],
  datagrip: [{ name: 'DataGrip', extensions: ['xml'] }, { name: '*', extensions: ['*'] }],
  lingua: [{ name: 'Lingua', extensions: ['json'] }, { name: '*', extensions: ['*'] }],
};

/** Where each client keeps its connections on this platform, for the dialog to open in. */
function importFolder(source: SqlDbImportSource): string | undefined {
  const home = homedir();
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  if (source === 'tableplus') return process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'com.tinyapp.TablePlus', 'Data') : undefined;
  if (source === 'dbeaver') {
    const base =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'DBeaverData')
        : process.platform === 'win32'
          ? path.join(appData, 'DBeaverData')
          : path.join(home, '.local', 'share', 'DBeaverData');
    return path.join(base, 'workspace6', 'General', '.dbeaver');
  }
  return undefined;
}

const MAX_ENV_BYTES = 256 * 1024;

const realOrSelf = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

export function registerSqlDbHandlers(service: SqlDbService, blockedPath: (filePath: string) => string | null): void {
  /** Outside protected folders, or exactly a client's own file in an app-data folder; checked as given and after symlinks. */
  const importReadable = (source: SqlDbImportSource, file: string) =>
    [file, realOrSelf(file)].every((candidate) => {
      const family = blockedPath(candidate);
      return family === null || (family === 'app-data' && isClientFile(source, candidate, homedir()));
    });

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
      return [draft(args[0], 'sql-db:save'), id, secret(args[2], 'sql-db:save'), secret(args[3], 'sql-db:save')] as [
        SqlConnectionDraft,
        string | undefined,
        string | undefined,
        string | undefined,
      ];
    },
    (_event, value, id, password, sshPassword) => service.save(value, id, password, sshPassword)
  );

  validatedHandle('sql-db:delete', (args) => [connectionId(args[0], 'sql-db:delete')] as [string], (_event, id) => service.remove(id));

  validatedHandle(
    'sql-db:open-adhoc',
    (args) =>
      [draft(args[0], 'sql-db:open-adhoc'), secret(args[1], 'sql-db:open-adhoc'), secret(args[2], 'sql-db:open-adhoc')] as [
        SqlConnectionDraft,
        string | undefined,
        string | undefined,
      ],
    (_event, value, password, sshPassword) => service.openAdhoc(value, password, sshPassword)
  );

  validatedHandle(
    'sql-db:session-password',
    (args) => {
      const kind = args[2] === undefined ? 'database' : args[2] === 'database' || args[2] === 'ssh' ? args[2] : fail('sql-db:session-password');
      return [connectionId(args[0], 'sql-db:session-password'), secret(args[1], 'sql-db:session-password') ?? fail('sql-db:session-password'), kind] as [
        string,
        string,
        SqlDbSecretKind,
      ];
    },
    (_event, id, password, kind) => service.sessionPassword(id, password, kind)
  );

  validatedHandle(
    'sql-db:trust-host-key',
    (args) =>
      [hostName(args[0], 'sql-db:trust-host-key'), port(args[1], 'sql-db:trust-host-key'), fingerprint(args[2], 'sql-db:trust-host-key')] as [string, number, string],
    async (_event, host, sshPort, value) => ({ ok: await service.trustHostKey(host, sshPort, value) })
  );

  validatedHandle('sql-db:ssh-info', (args) => [hostName(args[0], 'sql-db:ssh-info')] as [string], (_event, alias) => service.sshInfo(alias));

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
      return kind === 'sqlite' || kind === 'ca' || kind === 'cert' || kind === 'key' || kind === 'ssh-key'
        ? ([kind] as [SqlDbFileKind])
        : fail('sql-db:pick-file');
    },
    async (event, kind) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        properties: kind === 'ssh-key' ? ['openFile', 'showHiddenFiles'] : ['openFile'],
        filters: FILE_FILTERS[kind],
        ...(kind === 'ssh-key' ? { defaultPath: path.join(homedir(), '.ssh') } : {}),
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const chosen = picked.filePaths[0];
      if (picked.canceled || !chosen) return { canceled: true } as const;
      const blocked = blockedPath(chosen);
      if (blocked && !(kind === 'ssh-key' && blocked === 'credentials' && isSshFolderFile(chosen))) return { canceled: true, blocked: true } as const;
      if (kind === 'ssh-key') service.chooseSshKey(chosen);
      return { canceled: false, path: chosen } as const;
    }
  );

  validatedHandle(
    'sql-db:import-file',
    (args) => [(SQL_DB_IMPORT_SOURCES as readonly unknown[]).includes(args[0]) ? (args[0] as SqlDbImportSource) : fail('sql-db:import-file')] as [SqlDbImportSource],
    async (event, source) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const folder = importFolder(source);
      const options: Electron.OpenDialogOptions = { properties: ['openFile', 'showHiddenFiles'], filters: IMPORT_FILTERS[source], ...(folder ? { defaultPath: folder } : {}) };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const chosen = picked.filePaths[0];
      if (picked.canceled || !chosen) return { canceled: true } as const;
      if (!importReadable(source, chosen)) return { canceled: false, found: [], skipped: 0, error: 'unreadable' } as const;
      const sibling = siblingFile(source, chosen);
      const result = importCandidates(source, await readSmallFile(chosen, MAX_IMPORT_BYTES), {
        sibling: sibling && importReadable(source, sibling) ? await readSmallFile(sibling, MAX_IMPORT_BYTES) : null,
        home: homedir(),
        picked: chosen,
      });
      // Only these exact tunnels may later use a ~/.ssh key the file names, and only once the user saves one.
      service.offerImportedTunnels(result.canceled ? [] : result.found.flatMap(({ draft }) => (draft.ssh ? [draft.ssh] : [])));
      return result;
    }
  );

  validatedHandle(
    'sql-db:import-env',
    (args) => [typeof args[0] === 'string' && args[0].length > 0 && args[0].length <= 256 ? args[0] : fail('sql-db:import-env')] as [string],
    async (_event, rootId) => {
      const found: SqlDbImportCandidate[] = [];
      let skipped = 0;
      for (const file of ENV_FILES) {
        const resolved = await resolveCapabilityPath(rootId, file, 'read');
        if (!resolved.ok) {
          if (resolved.error === 'unknown-root') return { canceled: false, found: [], skipped: 0, error: 'unreadable' } as const;
          continue;
        }
        const data = await readSmallFile(resolved.absolutePath, MAX_ENV_BYTES);
        if (!data) continue;
        const parsed = envCandidates(data.toString('utf-8'), file);
        found.push(...parsed.found);
        skipped += parsed.skipped;
      }
      return { canceled: false, ...checkedCandidates(found, skipped) } as const;
    }
  );

  validatedHandle(
    'sql-db:export',
    (args) => (args.length === 0 ? ([] as []) : fail('sql-db:export')),
    async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.SaveDialogOptions = { defaultPath: 'lingua-connections.json', filters: IMPORT_FILTERS.lingua };
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return { canceled: true } as const;
      const { text, count } = await service.exportCatalog();
      if (blockedPath(picked.filePath)) return { canceled: false, ok: false, count } as const;
      // A link would send the file somewhere the path does not say.
      if (await lstat(picked.filePath).then((stat) => stat.isSymbolicLink(), () => false)) return { canceled: false, ok: false, count } as const;
      try {
        await writeFile(picked.filePath, text, { mode: 0o600 });
        // The mode applies only to a new file; an overwritten one keeps its permissions otherwise.
        if (process.platform !== 'win32') await chmod(picked.filePath, 0o600);
        return { canceled: false, ok: true, count } as const;
      } catch {
        return { canceled: false, ok: false, count } as const;
      }
    }
  );
}
