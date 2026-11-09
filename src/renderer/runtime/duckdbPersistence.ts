import { OPFS_SQL_DB_FILE, OPFS_SQL_DB_PATH, OPFS_SQL_WAL_FILE, type SqlStorageMode } from '../../shared/sqlWorkspace';

interface PersistentDuckDb {
  open(config: { path: string; accessMode: number; opfs: { fileHandling: 'auto' } }): Promise<void>;
  registerFileHandle(name: string, handle: FileSystemFileHandle, protocol: number, directIO: boolean): Promise<void>;
}

/** A fresh in-memory instance; killing its worker must release even unregistered OPFS handles. */
export interface OwnedDuckDb<Db extends PersistentDuckDb> {
  db: Db;
  terminateWorker(): void;
}

async function existingFile(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle | null> {
  try {
    return await root.getFileHandle(name);
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError') return null;
    throw error;
  }
}

/** DuckDB-WASM 1.32 auto handling skips empty WAL handles beside an existing database. */
async function prepareMissingWal(
  db: PersistentDuckDb,
  storage: Pick<StorageManager, 'getDirectory'>,
  protocol: number
): Promise<void> {
  const root = await storage.getDirectory();
  const database = await existingFile(root, OPFS_SQL_DB_FILE);
  if (!database || (await database.getFile()).size === 0) return;
  const wal = await existingFile(root, OPFS_SQL_WAL_FILE);
  if (wal && (await wal.getFile()).size > 0) return;

  // Acquire the database first. A competing owner must fail here, before we create a WAL.
  await db.registerFileHandle(OPFS_SQL_DB_PATH, database, protocol, true);
  // The inspection was not a lock. A WAL that gained content belongs to automatic recovery.
  const currentWal = await existingFile(root, OPFS_SQL_WAL_FILE);
  if (currentWal && (await currentWal.getFile()).size > 0) return;
  const handle = currentWal ?? await root.getFileHandle(OPFS_SQL_WAL_FILE, { create: true });
  await db.registerFileHandle(`${OPFS_SQL_DB_PATH}.wal`, handle, protocol, true);
}

/**
 * Owns startup until success. Any OPFS failure discards the entire worker before
 * creating one clean memory fallback; never reuse a worker with partial handles.
 * create must also destroy its worker if instantiation rejects before returning.
 */
export async function openOwnedDuckDb<Db extends PersistentDuckDb>(
  create: () => Promise<OwnedDuckDb<Db>>,
  options: {
    persist: boolean;
    storage?: Pick<StorageManager, 'getDirectory'>;
    protocol: number;
    /** DuckDBAccessMode.READ_WRITE from the loaded duckdb-wasm module. */
    accessMode: number;
  }
): Promise<{ instance: OwnedDuckDb<Db>; mode: SqlStorageMode }> {
  const instance = await create();
  if (!options.persist || !options.storage) return { instance, mode: 'memory' };
  try {
    await prepareMissingWal(instance.db, options.storage, options.protocol);
    await instance.db.open({ path: OPFS_SQL_DB_PATH, accessMode: options.accessMode, opfs: { fileHandling: 'auto' } });
    return { instance, mode: 'opfs' };
  } catch (error) {
    // Only the error name: a lock, quota or registration failure, without paths.
    const name = (error as { name?: unknown } | null)?.name;
    console.warn('[sql] OPFS persistence unavailable, using memory:', typeof name === 'string' ? name : 'unknown');
    instance.terminateWorker();
  }
  return { instance: await create(), mode: 'memory' };
}
