import type { SqlRemoteEngine } from '../../../shared/sqlConnections';
import type { SqlDbObjectInfo, SqlDbObjectKind } from '../../../shared/sqlDb';

type SqlRemoteGroupId = 'tables' | 'views' | 'matviews' | 'functions' | 'routines' | 'sequences' | 'extensions';

const POSTGRES_GROUPS = [
  { id: 'tables', kinds: ['table'] },
  { id: 'views', kinds: ['view'] },
  { id: 'matviews', kinds: ['matview'] },
  { id: 'functions', kinds: ['function', 'procedure'] },
  { id: 'sequences', kinds: ['sequence'] },
  { id: 'extensions', kinds: ['extension'] },
] as const;
const SQLITE_GROUPS = [
  { id: 'tables', kinds: ['table'] },
  { id: 'views', kinds: ['view'] },
] as const;

/** The groups each engine has, in tree order. MySQL calls its functions and procedures routines. */
const ENGINE_GROUPS: Readonly<Record<SqlRemoteEngine, ReadonlyArray<{ id: SqlRemoteGroupId; kinds: ReadonlyArray<SqlDbObjectKind> }>>> = {
  postgres: POSTGRES_GROUPS,
  neon: POSTGRES_GROUPS,
  mysql: [
    { id: 'tables', kinds: ['table'] },
    { id: 'views', kinds: ['view'] },
    { id: 'routines', kinds: ['function', 'procedure'] },
  ],
  sqlite: SQLITE_GROUPS,
  libsql: SQLITE_GROUPS,
  d1: SQLITE_GROUPS,
  sqlserver: [
    { id: 'tables', kinds: ['table'] },
    { id: 'views', kinds: ['view'] },
    { id: 'functions', kinds: ['function', 'procedure'] },
    { id: 'sequences', kinds: ['sequence'] },
  ],
  clickhouse: [
    { id: 'tables', kinds: ['table'] },
    { id: 'views', kinds: ['view'] },
    { id: 'matviews', kinds: ['matview'] },
  ],
};

/** Kinds whose rows can be read with a SELECT. */
export const QUERYABLE_KINDS: ReadonlySet<SqlDbObjectKind> = new Set(['table', 'view', 'matview']);

export interface SqlRemoteGroup {
  id: SqlRemoteGroupId;
  objects: SqlDbObjectInfo[];
}

export const matchesObjectFilter = (filter: string, name: string) => {
  const needle = filter.trim().toLowerCase();
  return needle.length === 0 || name.toLowerCase().includes(needle);
};

/**
 * One schema's objects in the engine's groups. Without a filter, Tables
 * always shows and the other groups show when they hold something; with
 * one, only groups with a match show.
 */
export function groupRemoteObjects(engine: SqlRemoteEngine, objects: ReadonlyArray<SqlDbObjectInfo>, filter: string): SqlRemoteGroup[] {
  const filtering = filter.trim().length > 0;
  return ENGINE_GROUPS[engine]
    .map((group) => ({
      id: group.id,
      objects: objects.filter((object) => group.kinds.includes(object.kind) && matchesObjectFilter(filter, object.name)),
    }))
    .filter((group) => (filtering ? group.objects.length > 0 : group.id === 'tables' || group.objects.length > 0));
}
