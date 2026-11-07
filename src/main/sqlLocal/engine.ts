/**
 * The Local SQL engine inside its utilityProcess: one DuckDB instance per
 * renderer, locked before any SQL runs. `enable_external_access=false` with
 * `allowed_directories` refuses every path but the renderer's files and spill
 * folders, network reads, INSTALL and LOAD; `lock_configuration` then fixes every
 * setting, so SQL cannot point the extension, secret or profiling paths
 * elsewhere. JSON, ICU and Parquet are compiled into the library.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DuckDBConnection, DuckDBInstance, DuckDBResult, DuckDBType } from '@duckdb/node-api';
import { createRowAccumulator } from '../../shared/sqlResultRows';
import { SQL_LOCAL_MAX_CONNECTIONS, SQL_LOCAL_MAX_READ_BYTES, SQL_LOCAL_MAX_STREAMS, type SqlLocalError, type SqlLocalOpened, type SqlLocalQueryResult, type SqlLocalStreamOpened } from '../../shared/sqlLocal';
import type { SqlColumnMetadata, SqlStorageMode } from '../../shared/sqlWorkspace';
import { cellConverter, columnsOf, rowsOf } from './cells';
import type { LocalPaths, LocalRequest, LocalResponse } from './protocol';

type NodeApi = Pick<typeof import('@duckdb/node-api'), 'DuckDBInstance'>;

interface Stream {
  id: string;
  result: DuckDBResult;
  names: string[];
  converters: Array<ReturnType<typeof cellConverter>>;
}

interface Connection {
  id: string;
  engineId: string;
  connection: DuckDBConnection;
  stream: Stream | null;
  /** The DuckDB call in flight; a close waits for it so the binding never frees a busy connection. */
  busy: Promise<unknown> | null;
}

interface Engine {
  id: string;
  owner: number;
  instance: DuckDBInstance;
  persistent: boolean;
  paths: LocalPaths;
  connections: Map<string, Connection>;
}

class LocalError extends Error {
  constructor(
    message: string,
    readonly code?: SqlLocalError['code']
  ) {
    super(message);
  }
}

const gone = () => new LocalError('The SQL engine stopped. Run the query again to start a new one.', 'engine-gone');

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const home = homedir();

/** DuckDB's message without the binding's prefix, the files folder WASM never shows, or the home folder. */
function messageOf(error: unknown, filesDir?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/^Failed to extract statements: /, '');
  if (filesDir) message = message.replaceAll(`${filesDir}${path.sep}`, '').replaceAll(`${filesDir}/`, '');
  return home ? message.replaceAll(home, '~') : message;
}

async function freshFolder(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export function createSqlLocalEngine(load: () => Promise<NodeApi>) {
  const engines = new Map<string, Engine>();
  const connections = new Map<string, Connection>();
  const streams = new Map<string, { owner: number; connection: Connection }>();

  const engineFor = (owner: number, engineId: string): Engine => {
    const engine = engines.get(engineId);
    if (!engine || engine.owner !== owner) throw gone();
    return engine;
  };

  const connectionFor = (owner: number, connectionId: string): Connection => {
    const entry = connections.get(connectionId);
    if (!entry || engines.get(entry.engineId)?.owner !== owner) throw gone();
    return entry;
  };

  const filesDirOf = (connection: Connection) => engines.get(connection.engineId)?.paths.files;

  async function run<T>(entry: Connection, work: () => Promise<T>): Promise<T> {
    const pending = work();
    entry.busy = pending;
    try {
      return await pending;
    } catch (error) {
      throw new LocalError(messageOf(error, filesDirOf(entry)));
    } finally {
      if (entry.busy === pending) entry.busy = null;
    }
  }

  function dropStream(entry: Connection): void {
    if (!entry.stream) return;
    streams.delete(entry.stream.id);
    entry.stream = null;
  }

  async function closeConnection(entry: Connection): Promise<void> {
    if (!connections.delete(entry.id)) return;
    dropStream(entry);
    engines.get(entry.engineId)?.connections.delete(entry.id);
    try {
      entry.connection.interrupt();
    } catch {
      /* nothing was running */
    }
    await entry.busy?.catch(() => undefined);
    try {
      entry.connection.closeSync();
    } catch {
      /* already closed with its instance */
    }
  }

  async function closeEngine(engine: Engine): Promise<void> {
    if (!engines.delete(engine.id)) return;
    await Promise.all([...engine.connections.values()].map(closeConnection));
    try {
      engine.instance.closeSync();
    } catch {
      /* closing writes the last checkpoint; a failure leaves the WAL for the next open */
    }
    await Promise.all([rm(engine.paths.files, { recursive: true, force: true }), rm(engine.paths.temp, { recursive: true, force: true })]);
  }

  async function releaseOwner(owner: number): Promise<void> {
    await Promise.all([...engines.values()].filter(engine => engine.owner === owner).map(closeEngine));
  }

  async function open(owner: number, persist: boolean, paths: LocalPaths): Promise<SqlLocalOpened> {
    await releaseOwner(owner);
    const { DuckDBInstance } = await load();
    await Promise.all([freshFolder(paths.files), freshFolder(paths.temp)]);
    const config = {
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
      temp_directory: paths.temp,
    };
    let instance: DuckDBInstance | null = null;
    let storageMode: SqlStorageMode = 'memory';
    // One engine at a time holds the file; another falls back to memory, as a second WASM tab does.
    if (persist && ![...engines.values()].some(engine => engine.persistent)) {
      try {
        await mkdir(path.dirname(paths.database), { recursive: true });
        instance = await DuckDBInstance.create(paths.database, config);
        storageMode = 'opfs';
      } catch {
        instance = null;
      }
    }
    instance ??= await DuckDBInstance.create(':memory:', config);
    let version = '';
    const setup = await instance.connect();
    try {
      await setup.run(`SET allowed_directories=[${literal(paths.files)}, ${literal(paths.temp)}]`);
      await setup.run('SET enable_external_access=false');
      // Last: profiling_output writes outside DuckDB's file checks, and extension_directory could aim INSTALL at an allowed folder.
      await setup.run('SET lock_configuration=true');
      version = String((await setup.runAndReadAll('SELECT version()')).getRows()[0]?.[0] ?? '');
    } catch (error) {
      instance.closeSync();
      throw error;
    } finally {
      setup.closeSync();
    }
    const engine: Engine = { id: randomUUID(), owner, instance, persistent: storageMode === 'opfs', paths, connections: new Map() };
    engines.set(engine.id, engine);
    return { engineId: engine.id, storageMode, version, filesDir: paths.files };
  }

  async function connect(owner: number, engineId: string): Promise<string> {
    const engine = engineFor(owner, engineId);
    if (engine.connections.size >= SQL_LOCAL_MAX_CONNECTIONS) throw new LocalError('Too many open SQL connections.');
    const entry: Connection = { id: randomUUID(), engineId, connection: await engine.instance.connect(), stream: null, busy: null };
    // The engine may have closed while DuckDB connected.
    if (!engines.has(engineId)) {
      entry.connection.closeSync();
      throw gone();
    }
    engine.connections.set(entry.id, entry);
    connections.set(entry.id, entry);
    return entry.id;
  }

  const fieldsOf = (columns: SqlColumnMetadata[]) => columns.map(column => ({ name: column.name, type: { toString: () => column.type } }));

  async function query(owner: number, connectionId: string, sql: string): Promise<SqlLocalQueryResult> {
    const entry = connectionFor(owner, connectionId);
    dropStream(entry);
    return run(entry, async () => {
      const result = await entry.connection.run(sql);
      const names = result.columnNames();
      const types: DuckDBType[] = result.columnTypes();
      const columns = columnsOf(names, types);
      const converters = types.map(cellConverter);
      const accumulator = createRowAccumulator(fieldsOf(columns));
      let rowCount = 0;
      for (let chunk = await result.fetchChunk(); chunk && chunk.rowCount > 0; chunk = await result.fetchChunk()) {
        rowCount += chunk.rowCount;
        if (!accumulator.isFull()) accumulator.add(rowsOf(names, converters, chunk.getRows()));
      }
      return { columns, rows: accumulator.rows, rowCount, tooLarge: accumulator.isFull() && accumulator.rows.length < rowCount };
    });
  }

  async function stream(owner: number, connectionId: string, sql: string): Promise<SqlLocalStreamOpened> {
    const entry = connectionFor(owner, connectionId);
    dropStream(entry);
    if (streams.size >= SQL_LOCAL_MAX_STREAMS) throw new LocalError('Too many open SQL results.');
    return run(entry, async () => {
      const result = await entry.connection.stream(sql);
      const names = result.columnNames();
      const types = result.columnTypes();
      const opened: Stream = { id: randomUUID(), result, names, converters: types.map(cellConverter) };
      entry.stream = opened;
      streams.set(opened.id, { owner, connection: entry });
      return { streamId: opened.id, columns: columnsOf(names, types) };
    });
  }

  async function next(owner: number, streamId: string): Promise<Array<Record<string, unknown>> | null> {
    const found = streams.get(streamId);
    if (!found || found.owner !== owner || found.connection.stream?.id !== streamId) throw gone();
    const entry = found.connection;
    const current = entry.stream!;
    return run(entry, async () => {
      const chunk = await current.result.fetchChunk();
      if (!chunk || chunk.rowCount === 0) {
        if (entry.stream === current) dropStream(entry);
        return null;
      }
      return rowsOf(current.names, current.converters, chunk.getRows());
    });
  }

  function cancel(owner: number, connectionId: string): boolean {
    const entry = connectionFor(owner, connectionId);
    entry.connection.interrupt();
    return true;
  }

  function fileIn(engine: Engine, name: string): string {
    // Main checked the name; this keeps the engine safe on its own.
    if (path.basename(name) !== name) throw new LocalError('Invalid file name.');
    return path.join(engine.paths.files, name);
  }

  async function readEngineFile(engine: Engine, name: string): Promise<Uint8Array> {
    const file = fileIn(engine, name);
    if ((await stat(file)).size > SQL_LOCAL_MAX_READ_BYTES) throw new LocalError('The file DuckDB wrote is too large to read back.');
    const data = await readFile(file);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  async function handle(request: LocalRequest): Promise<unknown> {
    switch (request.type) {
      case 'open':
        return open(request.owner, request.persist, request.paths);
      case 'connect':
        return connect(request.owner, request.engineId);
      case 'query':
        return query(request.owner, request.connectionId, request.sql);
      case 'stream':
        return stream(request.owner, request.connectionId, request.sql);
      case 'next':
        return next(request.owner, request.streamId);
      case 'cancel':
        return cancel(request.owner, request.connectionId);
      case 'close-connection': {
        const entry = connections.get(request.connectionId);
        if (entry && engines.get(entry.engineId)?.owner === request.owner) await closeConnection(entry);
        return null;
      }
      case 'register-file':
        await writeFile(fileIn(engineFor(request.owner, request.engineId), request.name), request.bytes);
        return null;
      case 'register-empty-file':
        await writeFile(fileIn(engineFor(request.owner, request.engineId), request.name), new Uint8Array());
        return null;
      case 'drop-file':
        await rm(fileIn(engineFor(request.owner, request.engineId), request.name), { force: true });
        return null;
      case 'read-file':
        return readEngineFile(engineFor(request.owner, request.engineId), request.name);
      case 'terminate': {
        const engine = engines.get(request.engineId);
        if (engine && engine.owner === request.owner) await closeEngine(engine);
        return null;
      }
      case 'release-owner':
        await releaseOwner(request.owner);
        return null;
      case 'clear-database':
        if ([...engines.values()].some(engine => engine.persistent)) throw new LocalError('The SQL database is in use.');
        await Promise.all([unlink(request.database), unlink(`${request.database}.wal`)].map(removal => removal.catch(() => undefined)));
        return null;
      case 'database-bytes':
        try {
          return (await sizeOf(request.database)) + (await sizeOf(`${request.database}.wal`));
        } catch {
          return null;
        }
    }
  }

  return {
    async handle(request: LocalRequest): Promise<LocalResponse> {
      try {
        return { id: request.id, ok: true, result: await handle(request) };
      } catch (error) {
        const code = error instanceof LocalError ? error.code : undefined;
        return { id: request.id, ok: false, error: { message: messageOf(error), ...(code ? { code } : {}) } };
      }
    },
    async dispose(): Promise<void> {
      await Promise.all([...engines.values()].map(closeEngine));
    },
  };
}

export type SqlLocalEngine = ReturnType<typeof createSqlLocalEngine>;
