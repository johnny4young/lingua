/**
 * `sql-local:*` IPC over the native Local SQL engine. Every argument is parsed
 * here: ids and file names against the shapes the engine hands out, SQL and
 * file bytes against size caps. The sender's WebContents is the owner, and its
 * engine ends when that document does.
 */

import { isSqlLocalFileName, isSqlLocalId, SQL_LOCAL_MAX_FILE_BYTES } from '../../shared/sqlLocal';
import { onOwnerReset } from '../runners/ownerReset';
import type { SqlLocalService } from '../sqlLocal/service';
import { validatedHandle } from './typedHandle';

/** Notebook and script SQL can outgrow the editor's 256 KiB; this still bounds one message. */
const SQL_LOCAL_MAX_SQL_BYTES = 4 * 1024 * 1024;

const fail = (channel: string): never => {
  throw new Error(`Invalid ${channel} arguments`);
};

const id = (value: unknown, channel: string): string => (isSqlLocalId(value) ? value : fail(channel));
const fileName = (value: unknown, channel: string): string => (isSqlLocalFileName(value) ? value : fail(channel));
const flag = (value: unknown, channel: string): boolean => (typeof value === 'boolean' ? value : fail(channel));
const sql = (value: unknown, channel: string): string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= SQL_LOCAL_MAX_SQL_BYTES ? value : fail(channel);
const bytes = (value: unknown, channel: string): Uint8Array =>
  value instanceof Uint8Array && value.byteLength <= SQL_LOCAL_MAX_FILE_BYTES ? value : fail(channel);
const none = (args: readonly unknown[], channel: string): [] => (args.length === 0 ? [] : fail(channel));

export function registerSqlLocalHandlers(service: SqlLocalService): void {
  const watched = new Set<number>();
  const own = (sender: Electron.WebContents): number => {
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      const owner = sender.id;
      // Fires on every reload; the next request subscribes again, so this one goes.
      const unsubscribe = onOwnerReset(sender, () => {
        unsubscribe();
        watched.delete(owner);
        service.releaseOwner(owner);
      });
    }
    return sender.id;
  };

  validatedHandle('sql-local:status', (args) => none(args, 'sql-local:status'), () => service.status());

  validatedHandle('sql-local:open', (args) => [flag(args[0], 'sql-local:open')] as [boolean], (event, persist) => service.open(own(event.sender), persist));

  validatedHandle('sql-local:connect', (args) => [id(args[0], 'sql-local:connect')] as [string], (event, engineId) => service.connect(own(event.sender), engineId));

  validatedHandle(
    'sql-local:query',
    (args) => [id(args[0], 'sql-local:query'), sql(args[1], 'sql-local:query')] as [string, string],
    (event, connectionId, text) => service.query(own(event.sender), connectionId, text)
  );

  validatedHandle(
    'sql-local:stream',
    (args) => [id(args[0], 'sql-local:stream'), sql(args[1], 'sql-local:stream')] as [string, string],
    (event, connectionId, text) => service.stream(own(event.sender), connectionId, text)
  );

  validatedHandle('sql-local:next', (args) => [id(args[0], 'sql-local:next')] as [string], (event, streamId) => service.next(own(event.sender), streamId));

  validatedHandle('sql-local:cancel', (args) => [id(args[0], 'sql-local:cancel')] as [string], (event, connectionId) => service.cancel(own(event.sender), connectionId));

  validatedHandle(
    'sql-local:close-connection',
    (args) => [id(args[0], 'sql-local:close-connection')] as [string],
    (event, connectionId) => service.closeConnection(own(event.sender), connectionId)
  );

  validatedHandle(
    'sql-local:register-file',
    (args) => [id(args[0], 'sql-local:register-file'), fileName(args[1], 'sql-local:register-file'), bytes(args[2], 'sql-local:register-file')] as [string, string, Uint8Array],
    (event, engineId, name, data) => service.registerFile(own(event.sender), engineId, name, data)
  );

  validatedHandle(
    'sql-local:register-empty-file',
    (args) => [id(args[0], 'sql-local:register-empty-file'), fileName(args[1], 'sql-local:register-empty-file')] as [string, string],
    (event, engineId, name) => service.registerEmptyFile(own(event.sender), engineId, name)
  );

  validatedHandle(
    'sql-local:drop-file',
    (args) => [id(args[0], 'sql-local:drop-file'), fileName(args[1], 'sql-local:drop-file')] as [string, string],
    (event, engineId, name) => service.dropFile(own(event.sender), engineId, name)
  );

  validatedHandle(
    'sql-local:read-file',
    (args) => [id(args[0], 'sql-local:read-file'), fileName(args[1], 'sql-local:read-file')] as [string, string],
    (event, engineId, name) => service.readFile(own(event.sender), engineId, name)
  );

  validatedHandle(
    'sql-local:terminate',
    (args) => [id(args[0], 'sql-local:terminate'), flag(args[1], 'sql-local:terminate')] as [string, boolean],
    (event, engineId, force) => service.terminate(own(event.sender), engineId, force)
  );

  validatedHandle('sql-local:clear-database', (args) => none(args, 'sql-local:clear-database'), () => service.clearDatabase());

  validatedHandle('sql-local:database-bytes', (args) => none(args, 'sql-local:database-bytes'), () => service.databaseBytes());
}
