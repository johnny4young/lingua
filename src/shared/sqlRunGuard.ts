/**
 * The write guards every run and staged edit passes before it reaches an
 * engine, shared by main and the browser's session-only connections.
 */

import type { SqlConnectionV1 } from './sqlConnections';
import type { SqlDbApplyResult, SqlDbRunOptions } from './sqlDb';
import { ROW_EDIT_ENGINES } from './sqlRowEdits';
import { isWriteSqlStatementOn, provesReadsOnly } from './sqlStatements';

type GuardedConnection = Pick<SqlConnectionV1, 'engine' | 'name' | 'readOnly' | 'env' | 'confirmWrites'>;

const PROVEN_READS: Readonly<Record<'sqlserver' | 'd1', string>> = {
  sqlserver: 'on SQL Server it runs one SELECT or WITH query at a time',
  d1: 'on D1 it runs one SELECT, WITH or VALUES statement at a time',
};

/**
 * Whether a run writes, and why it is refused: production and Confirm every
 * write need the typed name before a write, lifting read-only always does,
 * and an engine without a read-only session runs only proven reads.
 */
export function runGuard(connection: GuardedConnection, sql: string, options: Pick<SqlDbRunOptions, 'readWrite'>): { writes: boolean; refusal?: string } {
  const writes = isWriteSqlStatementOn(connection.engine, sql);
  const confirmed = options.readWrite?.confirmName === connection.name;
  if (writes && connection.readOnly && provesReadsOnly(connection.engine) && !(options.readWrite && confirmed)) {
    const engine = connection.engine as 'sqlserver' | 'd1';
    return { writes, refusal: `This connection is read-only, and ${PROVEN_READS[engine]}; anything else needs the typed connection name.` };
  }
  if (writes && connection.env === 'prod' && !confirmed) return { writes, refusal: 'Writes to production need the typed connection name.' };
  if (writes && connection.confirmWrites && !confirmed) return { writes, refusal: 'Writes on this connection need the typed connection name.' };
  if (options.readWrite && !confirmed) return { writes, refusal: 'Type the connection name to run it read-write.' };
  return { writes };
}

/** Why staged edits never reach the engine, or null when they may. */
export function editGuard(connection: GuardedConnection, confirmName: string | undefined): Extract<SqlDbApplyResult, { ok: false }> | null {
  if (connection.readOnly) return { ok: false, reason: 'read-only' };
  if (connection.env === 'prod') return { ok: false, reason: 'production' };
  if (connection.confirmWrites && confirmName !== connection.name) return { ok: false, reason: 'confirm-needed' };
  if (!ROW_EDIT_ENGINES.has(connection.engine)) return { ok: false, reason: 'not-editable' };
  return null;
}
