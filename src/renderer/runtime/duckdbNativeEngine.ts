/**
 * The Local engine handle over the desktop's native DuckDB. It fills the same
 * seam as DuckDB-WASM, so `executeQuery`, streams, imports, exports and edits run
 * unchanged; rows arrive already in the shape the WASM preview produces.
 */

import type { SqlLocalBridge, SqlLocalErrorCode, SqlLocalReply } from '../../shared/sqlLocal';
import type { SqlStorageMode } from '../../shared/sqlWorkspace';
import type { ArrowTableLike, DuckDbConnection, DuckDbEngineHandle, DuckDbResultStream } from './duckdbClient';

class SqlLocalCallError extends Error {
  constructor(
    message: string,
    readonly code?: SqlLocalErrorCode
  ) {
    super(message);
    this.name = 'SqlLocalCallError';
  }
}

export interface NativeEngine {
  handle: DuckDbEngineHandle;
  storageMode: SqlStorageMode;
  version: string;
}

/**
 * Opens an engine for this window. `onGone` runs when the engine or its process
 * ended under the handle, so the caller can drop it and start a new one.
 */
export async function openNativeEngine(
  bridge: SqlLocalBridge,
  persist: boolean,
  onGone: (handle: DuckDbEngineHandle) => void
): Promise<NativeEngine> {
  let handle: DuckDbEngineHandle | null = null;
  const unwrap = async <T>(pending: Promise<SqlLocalReply<T>>): Promise<T> => {
    const reply = await pending;
    if (reply.ok) return reply.value;
    if (reply.error.code === 'engine-gone' && handle) onGone(handle);
    throw new SqlLocalCallError(reply.error.message, reply.error.code);
  };
  const opened = await unwrap(bridge.open(persist));
  const { engineId, filesDir } = opened;
  const separator = filesDir.includes('\\') ? '\\' : '/';

  const connect = async (): Promise<DuckDbConnection> => {
    const connectionId = await unwrap(bridge.connect(engineId));
    return {
      query: sql => unwrap(bridge.query(connectionId, sql)),
      stream: async (sql): Promise<DuckDbResultStream> => {
        const result = await unwrap(bridge.stream(connectionId, sql));
        const fields = result.columns.map(column => ({ name: column.name, type: { toString: () => column.type } }));
        return {
          fields: () => fields,
          next: async (): Promise<ArrowTableLike | null> => {
            const rows = await unwrap(bridge.next(result.streamId));
            return rows === null ? null : { numRows: rows.length, schema: { fields }, toArray: () => rows };
          },
        };
      },
      cancel: () => unwrap(bridge.cancel(connectionId)),
      close: async () => {
        await unwrap(bridge.closeConnection(connectionId));
      },
    };
  };

  handle = {
    connect,
    terminate: async options => {
      await unwrap(bridge.terminate(engineId, options?.force === true));
    },
    registerFile: async (name, data) => {
      await unwrap(bridge.registerFile(engineId, name, data));
    },
    registerEmptyFile: async name => {
      await unwrap(bridge.registerEmptyFile(engineId, name));
    },
    dropFile: async name => {
      await unwrap(bridge.dropFile(engineId, name));
    },
    readFile: name => unwrap(bridge.readFile(engineId, name)),
    filePath: name => `${filesDir}${separator}${name}`,
    // JSON, ICU and Parquet are compiled into the native library.
    loadJsonExtension: async () => true,
  };
  return { handle, storageMode: opened.storageMode, version: opened.version };
}
