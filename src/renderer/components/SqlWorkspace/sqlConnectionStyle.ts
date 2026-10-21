import type { SqlConnectionEnv, SqlRemoteEngine } from '../../../shared/sqlConnections';

export type SqlConnectionTone = 'local' | SqlConnectionEnv | 'none';

/** Border, background and dot of a connection chip: the environment's colour, cyan for Local. */
export const CONNECTION_TONE: Readonly<Record<SqlConnectionTone, { chip: string; dot: string; text: string }>> = {
  local: { chip: 'border-accent-fg bg-accent-tint', dot: 'bg-accent-fg', text: 'text-accent-fg' },
  dev: { chip: 'border-success-fg bg-success-bg', dot: 'bg-success-fg', text: 'text-success-fg' },
  staging: { chip: 'border-warning-fg bg-warning-bg', dot: 'bg-warning-fg', text: 'text-warning-fg' },
  prod: { chip: 'border-error-fg bg-error-bg', dot: 'bg-error-fg', text: 'text-error-fg' },
  none: { chip: 'border-border-strong bg-bg-panel-alt', dot: 'bg-fg-muted', text: 'text-fg-muted' },
};

export const toneOf = (env: SqlConnectionEnv | undefined): SqlConnectionTone => env ?? 'none';

export const ENGINE_LABEL: Readonly<Record<SqlRemoteEngine, string>> = {
  postgres: 'Postgres',
  mysql: 'MySQL',
  sqlite: 'SQLite',
};
