/**
 * Catalogs of database connections, read level by level as the Explorer
 * opens them and kept in memory for the session only. Refresh drops a
 * connection's levels; answers that arrive after it are ignored.
 */

import { create } from 'zustand';
import type {
  SqlDbIntrospect,
  SqlDbIntrospectResult,
  SqlDbObjectDetail,
  SqlDbObjectInfo,
  SqlDbObjectKind,
  SqlDbSchemaInfo,
  SqlDbSecretKind,
} from '../../shared/sqlDb';
import { sqlDbBridge } from '../runtime/sqlRemote';

export type SqlCatalogLevel<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T; truncated?: boolean }
  /** `passwordNeeded` names the secret a session connection still needs. */
  | { status: 'error'; message: string; passwordNeeded?: SqlDbSecretKind };

export type SqlRemoteColumn = NonNullable<SqlDbIntrospectResult['columns']>[number];

export interface SqlObjectRef {
  schema: string;
  name: string;
  kind: SqlDbObjectKind;
  signature?: string;
}

export interface SqlRemoteCatalog {
  generation: number;
  schemas?: SqlCatalogLevel<SqlDbSchemaInfo[]>;
  objects: Record<string, SqlCatalogLevel<SqlDbObjectInfo[]>>;
  columns: Record<string, SqlCatalogLevel<SqlRemoteColumn[]>>;
  details: Record<string, SqlCatalogLevel<SqlDbObjectDetail>>;
}

export const objectKey = (ref: SqlObjectRef) => `${ref.kind}\u0000${ref.schema}\u0000${ref.name}\u0000${ref.signature ?? ''}`;

interface SqlRemoteCatalogState {
  catalogs: Record<string, SqlRemoteCatalog>;
  loadSchemas: (connectionId: string) => Promise<void>;
  loadObjects: (connectionId: string, schema: string) => Promise<void>;
  loadColumns: (connectionId: string, schema: string) => Promise<void>;
  loadDetail: (connectionId: string, ref: SqlObjectRef) => Promise<void>;
  /** Drops what was read, so the open levels read again; answers already on their way are ignored. */
  refresh: (connectionId: string) => void;
}

const empty = (generation: number): SqlRemoteCatalog => ({ generation, objects: {}, columns: {}, details: {} });

type Slot = 'objects' | 'columns' | 'details';

export const useSqlRemoteCatalogStore = create<SqlRemoteCatalogState>((set, get) => {
  const catalogOf = (connectionId: string) => get().catalogs[connectionId] ?? empty(0);
  const patch = (connectionId: string, generation: number, update: (catalog: SqlRemoteCatalog) => SqlRemoteCatalog) =>
    set((state) => {
      const current = state.catalogs[connectionId] ?? empty(0);
      if (current.generation !== generation) return state;
      return { catalogs: { ...state.catalogs, [connectionId]: update(current) } };
    });

  /** Reads one level unless it is loaded or loading; an error reads again. */
  async function read<T>(
    connectionId: string,
    current: SqlCatalogLevel<unknown> | undefined,
    request: SqlDbIntrospect,
    store: (catalog: SqlRemoteCatalog, level: SqlCatalogLevel<T>) => SqlRemoteCatalog,
    pick: (result: SqlDbIntrospectResult) => T | undefined
  ) {
    const db = sqlDbBridge();
    if (!db || current?.status === 'loading' || current?.status === 'ready') return;
    const { generation } = catalogOf(connectionId);
    patch(connectionId, generation, (catalog) => store(catalog, { status: 'loading' }));
    let result: SqlDbIntrospectResult;
    try {
      result = await db.introspect(connectionId, request);
    } catch (err) {
      result = { errorMessage: err instanceof Error ? err.message : String(err) };
    }
    const value = pick(result);
    const level: SqlCatalogLevel<T> =
      result.errorMessage !== undefined || value === undefined
        ? {
            status: 'error',
            message: result.errorMessage ?? '',
            ...(result.fix === 'password-needed' ? { passwordNeeded: 'database' as const } : result.fix === 'ssh-password-needed' ? { passwordNeeded: 'ssh' as const } : {}),
          }
        : { status: 'ready', value, ...(result.truncated ? { truncated: true } : {}) };
    patch(connectionId, generation, (catalog) => store(catalog, level));
  }

  const inSlot =
    <T,>(slot: Slot, key: string) =>
    (catalog: SqlRemoteCatalog, level: SqlCatalogLevel<T>): SqlRemoteCatalog => ({
      ...catalog,
      [slot]: { ...catalog[slot], [key]: level },
    });

  return {
    catalogs: {},
    loadSchemas: (connectionId) =>
      read(connectionId, catalogOf(connectionId).schemas, { level: 'schemas' }, (catalog, level: SqlCatalogLevel<SqlDbSchemaInfo[]>) => ({ ...catalog, schemas: level }), (r) => r.schemas),
    loadObjects: (connectionId, schema) =>
      read(connectionId, catalogOf(connectionId).objects[schema], { level: 'objects', schema }, inSlot('objects', schema), (r) => r.objects),
    loadColumns: (connectionId, schema) =>
      read(connectionId, catalogOf(connectionId).columns[schema], { level: 'columns', schema }, inSlot('columns', schema), (r) => r.columns),
    loadDetail: (connectionId, ref) =>
      read(
        connectionId,
        catalogOf(connectionId).details[objectKey(ref)],
        { level: 'detail', ...ref },
        inSlot('details', objectKey(ref)),
        (r) => r.detail
      ),
    refresh: (connectionId) =>
      set((state) => ({ catalogs: { ...state.catalogs, [connectionId]: empty(catalogOf(connectionId).generation + 1) } })),
  };
});
