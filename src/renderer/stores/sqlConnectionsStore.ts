/**
 * The renderer's copy of main's connection catalog, for this session only:
 * main is the source of truth, and nothing here is persisted. Passwords
 * never reach this store; a view only says whether one is kept.
 */

import { create } from 'zustand';
import type { SqlConnectionDraft } from '../../shared/sqlConnections';
import type { SqlDbCatalogView, SqlDbConnectionView, SqlDbSaveResult } from '../../shared/sqlDb';
import { sqlDbBridge } from '../runtime/sqlRemote';
import { useSqlRemoteCatalogStore } from './sqlRemoteCatalogStore';
import { useSettingsStore } from './settingsStore';

interface SqlConnectionsState {
  catalog: SqlDbCatalogView | null;
  loading: boolean;
  refresh: () => Promise<void>;
  save: (draft: SqlConnectionDraft, id?: string, password?: string, sshPassword?: string) => Promise<SqlDbSaveResult>;
  remove: (id: string) => Promise<boolean>;
  openAdhoc: (draft: SqlConnectionDraft, password?: string, sshPassword?: string) => Promise<SqlDbSaveResult>;
}

const unavailable: SqlDbSaveResult = { ok: false, reason: 'invalid' };

export const useSqlConnectionsStore = create<SqlConnectionsState>((set, get) => ({
  catalog: null,
  loading: false,
  async refresh() {
    const db = sqlDbBridge();
    if (!db) return;
    set({ loading: true });
    try {
      set({ catalog: await db.catalog() });
    } finally {
      set({ loading: false });
    }
  },
  async save(draft, id, password, sshPassword) {
    const db = sqlDbBridge();
    if (!db) return unavailable;
    const result = await db.save(draft, id, password, sshPassword);
    // An edit can point the connection somewhere else.
    if (result.ok && id) useSqlRemoteCatalogStore.getState().refresh(id);
    if (result.ok) await get().refresh();
    return result;
  },
  async remove(id) {
    const db = sqlDbBridge();
    if (!db) return false;
    const { ok } = await db.delete(id);
    useSqlRemoteCatalogStore.getState().refresh(id);
    await get().refresh();
    return ok;
  },
  async openAdhoc(draft, password, sshPassword) {
    const db = sqlDbBridge();
    if (!db) return unavailable;
    const result = await db.openAdhoc(draft, password, sshPassword);
    if (result.ok) await get().refresh();
    return result;
  },
}));

/** Database connections are on: the Labs flag, on a desktop build. */
export const dbClientEnabled = () => useSettingsStore.getState().featureFlags.dbClient === true && sqlDbBridge() !== null;

/** Whether a password typed at connect time is kept in the keychain once it signs in. */
export function keepsAskedSecret(id: string | undefined, kind: 'database' | 'ssh'): boolean {
  const catalog = useSqlConnectionsStore.getState().catalog;
  const connection = catalog?.connections.find((entry) => entry.id === id);
  if (!connection || catalog?.vault === 'session') return false;
  return (kind === 'ssh' ? connection.ssh?.secretMode : connection.passwordMode) === 'keychain';
}

/** A saved or session connection by id, from the last catalog read. */
export function findConnection(id: string | undefined): SqlDbConnectionView | undefined {
  if (!id) return undefined;
  const catalog = useSqlConnectionsStore.getState().catalog;
  return catalog?.connections.find((entry) => entry.id === id) ?? catalog?.adhoc.find((entry) => entry.id === id);
}
