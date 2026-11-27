import type { SqlConnectionDraft, SqlConnectionEnv, SqlRemoteEngine } from '../../../shared/sqlConnections';

export type SqlConnectionTone = 'local' | SqlConnectionEnv | 'none';

/** Border, background and dot of a connection chip: the environment's colour, cyan for Local. `tab` marks a query tab. */
export const CONNECTION_TONE: Readonly<Record<SqlConnectionTone, { chip: string; dot: string; text: string; tab: string }>> = {
  local: { chip: 'border-accent-fg bg-accent-tint', dot: 'bg-accent-fg', text: 'text-accent-fg', tab: '' },
  dev: { chip: 'border-success-fg bg-success-bg', dot: 'bg-success-fg', text: 'text-success-fg', tab: 'border-t-2 border-t-success-fg' },
  staging: { chip: 'border-warning-fg bg-warning-bg', dot: 'bg-warning-fg', text: 'text-warning-fg', tab: 'border-t-2 border-t-warning-fg' },
  prod: { chip: 'border-error-fg bg-error-bg', dot: 'bg-error-fg', text: 'text-error-fg', tab: 'border-t-2 border-t-error-fg' },
  none: { chip: 'border-border-strong bg-bg-panel-alt', dot: 'bg-fg-muted', text: 'text-fg-muted', tab: '' },
};

export const toneOf = (env: SqlConnectionEnv | undefined): SqlConnectionTone => env ?? 'none';

export const ENGINE_LABEL: Readonly<Record<SqlRemoteEngine, string>> = {
  postgres: 'Postgres',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
  clickhouse: 'ClickHouse',
  libsql: 'Turso',
  neon: 'Neon',
  d1: 'D1',
};

export const LOCAL_ENGINE = 'DuckDB';

/** Where a query runs: the connection and its engine, or the local engine. */
export const connectionContextLabel = (connection?: Pick<SqlConnectionDraft, 'name' | 'engine'>) =>
  connection ? `${connection.name} · ${ENGINE_LABEL[connection.engine]}` : LOCAL_ENGINE;

/** The context a Start row keeps: the engine alone when the name is, or could be, the host. */
export const answerContextLabel = (connection?: Pick<SqlConnectionDraft, 'name' | 'engine' | 'host' | 'ssh'>) => {
  if (!connection) return LOCAL_ENGINE;
  const name = connection.name.toLowerCase();
  const hosts = [connection.host, connection.ssh?.host].filter((host): host is string => !!host).map(host => host.toLowerCase());
  const hostLike = /[./:@]/.test(name) || hosts.some(host => name === host || name === host.split('.')[0]);
  return hostLike ? ENGINE_LABEL[connection.engine] : connectionContextLabel(connection);
};

/** The engine, and RO when the connection is read-only. */
export const engineDetail = (connection: Pick<SqlConnectionDraft, 'engine' | 'readOnly'>, readOnlyLabel: string) =>
  `${ENGINE_LABEL[connection.engine]}${connection.readOnly ? ` · ${readOnlyLabel}` : ''}`;
