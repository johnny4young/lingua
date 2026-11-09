/**
 * The Local SQL engine inside its utilityProcess: one DuckDB instance per
 * renderer, locked before any SQL runs. `enable_external_access=false` with
 * `allowed_directories` refuses every path but the renderer's files folder
 * (spilling to the temp folder needs no grant), network reads, INSTALL and LOAD; `lock_configuration` then fixes every
 * setting, so SQL cannot point the extension, secret or profiling paths
 * elsewhere. JSON, ICU and Parquet are compiled into the library.
 */

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open as openFile, rm, unlink, writeFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import path from 'node:path';
import type { DuckDBConnection, DuckDBInstance, DuckDBResult, DuckDBType } from '@duckdb/node-api';
import { createRowAccumulator } from '../../shared/sqlResultRows';
import { SQL_LOCAL_MAX_CONNECTIONS, SQL_LOCAL_MAX_READ_BYTES, SQL_LOCAL_MAX_STREAMS, type SqlLocalError, type SqlLocalOpened, type SqlLocalQueryResult, type SqlLocalStreamOpened } from '../../shared/sqlLocal';
import type { SqlColumnMetadata, SqlStorageMode } from '../../shared/sqlWorkspace';
import { cellConverter, chunkRows, columnsOf, type PointerReader } from './cells';
import { sizeOf } from './fileSize';
import { withoutFolder } from './messages';
import type { LocalPaths, LocalRequest, LocalResponse } from './protocol';

type NodeApi = Pick<typeof import('@duckdb/node-api'), 'DuckDBInstance'>;

interface Stream {
  id: string;
  owner: number;
  result: DuckDBResult;
  names: string[];
  types: DuckDBType[];
  converters: Array<ReturnType<typeof cellConverter>>;
  /** The chunk being sent and the next row of it; rows are converted only as a batch takes them. */
  pending: { rows: ReturnType<typeof chunkRows>; next: number } | null;
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
  /** Bytes of each registered file, against the engine's quota. */
  files: Map<string, number>;
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
const closedConnection = () => new LocalError('The SQL connection is closed.');
const closedResult = () => new LocalError('The SQL result is closed.');

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** One stream batch stays near this many bytes of JSON; a single larger row still goes alone. */
const BATCH_BYTES = 8 * 1024 * 1024;
/** Registered files one engine may hold at once. */
const ENGINE_FILE_BYTES = 1024 * 1024 * 1024;
const NO_FOLLOW_WRITE = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

/** DuckDB's message without the binding's prefix or the files folder WASM never shows; main hides the home folder. */
function messageOf(error: unknown, filesDirs: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/^Failed to extract statements: /, '');
  for (const folder of filesDirs) message = withoutFolder(message, folder, '', true);
  return message;
}

async function freshFolder(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
}

/** `readPointer` lets text and blob cells be cut before their whole value is read. */
export function createSqlLocalEngine(load: () => Promise<NodeApi>, readPointer?: PointerReader) {
  const engines = new Map<string, Engine>();
  const connections = new Map<string, Connection>();
  const streams = new Map<string, { owner: number; connection: Connection }>();

  const engineFor = (owner: number, engineId: string): Engine => {
    const engine = engines.get(engineId);
    if (!engine || engine.owner !== owner) throw gone();
    return engine;
  };

  // An id this process never handed the owner means its engine is gone (a new process); otherwise the id was closed.
  const ownsEngine = (owner: number) => [...engines.values()].some(engine => engine.owner === owner);

  const connectionFor = (owner: number, connectionId: string): Connection => {
    const entry = connections.get(connectionId);
    if (entry && engines.get(entry.engineId)?.owner === owner) return entry;
    throw ownsEngine(owner) ? closedConnection() : gone();
  };

  const filesDirsOf = (owner: number) => [...engines.values()].filter(engine => engine.owner === owner).map(engine => engine.paths.files);
  const filesDirOf = (connection: Connection) => {
    const folder = engines.get(connection.engineId)?.paths.files;
    return folder ? [folder] : [];
  };
  // Opens, terminations and releases run one at a time, so two opens never both claim the database file.
  let lifecycle: Promise<unknown> = Promise.resolve();
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const next = lifecycle.then(work, work);
    lifecycle = next.catch(() => undefined);
    return next;
  };

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
      // Persistent secrets live in a folder shared with the user's own DuckDB, outside every check.
      allow_persistent_secrets: 'false',
      temp_directory: paths.temp,
      // SQL cannot change these once the configuration locks, so they are set to app-sized values here.
      memory_limit: `${Math.max(512, Math.floor(totalmem() / 2 / 1024 / 1024))}MiB`,
      max_temp_directory_size: '16GiB',
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
      await setup.run(`SET allowed_directories=[${literal(paths.files)}]`);
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
    const engine: Engine = { id: randomUUID(), owner, instance, persistent: storageMode === 'opfs', paths, connections: new Map(), files: new Map() };
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
        const rows = chunkRows(chunk, names, types, converters, readPointer);
        for (let index = 0; index < rows.rowCount && !accumulator.isFull(); index += 1) accumulator.add([rows.row(index)]);
      }
      return { columns, rows: accumulator.rows, rowCount, tooLarge: accumulator.isFull() && accumulator.rows.length < rowCount };
    });
  }

  async function stream(owner: number, connectionId: string, sql: string): Promise<SqlLocalStreamOpened> {
    const entry = connectionFor(owner, connectionId);
    dropStream(entry);
    if ([...streams.values()].filter(found => found.owner === owner).length >= SQL_LOCAL_MAX_STREAMS) throw new LocalError('Too many open SQL results.');
    return run(entry, async () => {
      const result = await entry.connection.stream(sql);
      // Closed while DuckDB started the result: the binding frees it once nothing holds it.
      if (connections.get(entry.id) !== entry) throw closedConnection();
      const names = result.columnNames();
      const types = result.columnTypes();
      const opened: Stream = { id: randomUUID(), owner, result, names, types, converters: types.map(cellConverter), pending: null };
      entry.stream = opened;
      streams.set(opened.id, { owner, connection: entry });
      return { streamId: opened.id, columns: columnsOf(names, types) };
    });
  }

  async function next(owner: number, streamId: string): Promise<Array<Record<string, unknown>> | null> {
    const found = streams.get(streamId);
    if (!found || found.owner !== owner || found.connection.stream?.id !== streamId) throw ownsEngine(owner) ? closedResult() : gone();
    const entry = found.connection;
    const current = entry.stream!;
    return run(entry, async () => {
      if (!current.pending || current.pending.next >= current.pending.rows.rowCount) {
        const chunk = await current.result.fetchChunk();
        if (!chunk || chunk.rowCount === 0) {
          if (entry.stream === current) dropStream(entry);
          return null;
        }
        current.pending = { rows: chunkRows(chunk, current.names, current.types, current.converters, readPointer), next: 0 };
      }
      // A chunk of wide rows crosses in several batches instead of one message of any size.
      const pending = current.pending;
      const batch: Array<Record<string, unknown>> = [];
      let bytes = 0;
      while (pending.next < pending.rows.rowCount && (batch.length === 0 || bytes < BATCH_BYTES)) {
        const row = pending.rows.row(pending.next);
        pending.next += 1;
        bytes += JSON.stringify(row).length;
        batch.push(row);
      }
      return batch;
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

  async function writeEngineFile(engine: Engine, name: string, bytes: Uint8Array): Promise<void> {
    const file = fileIn(engine, name);
    const used = [...engine.files.entries()].reduce((total, [other, size]) => (other === name ? total : total + size), 0);
    if (used + bytes.byteLength > ENGINE_FILE_BYTES) throw new LocalError('The SQL engine holds too many registered files.');
    // Reserved before the write, so two writes in flight cannot both pass the quota.
    const previous = engine.files.get(name);
    const reserved = bytes.byteLength;
    engine.files.set(name, reserved);
    try {
      await writeFile(file, bytes, { flag: NO_FOLLOW_WRITE });
    } catch (error) {
      if (engine.files.get(name) === reserved) {
        if (previous === undefined) engine.files.delete(name);
        else engine.files.set(name, previous);
      }
      throw error;
    }
  }

  async function readEngineFile(engine: Engine, name: string): Promise<Uint8Array> {
    // One handle for the size check and the read, so the file cannot grow in between.
    const handle = await openFile(fileIn(engine, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const { size } = await handle.stat();
      if (size > SQL_LOCAL_MAX_READ_BYTES) throw new LocalError('The file DuckDB wrote is too large to read back.');
      const data = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await handle.read(data, offset, size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return data.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }

  async function handle(request: LocalRequest): Promise<unknown> {
    switch (request.type) {
      case 'open':
        return serially(() => open(request.owner, request.persist, request.paths));
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
        await writeEngineFile(engineFor(request.owner, request.engineId), request.name, request.bytes);
        return null;
      case 'register-empty-file':
        await writeEngineFile(engineFor(request.owner, request.engineId), request.name, new Uint8Array());
        return null;
      case 'drop-file': {
        const engine = engineFor(request.owner, request.engineId);
        await rm(fileIn(engine, request.name), { force: true });
        engine.files.delete(request.name);
        return null;
      }
      case 'read-file':
        return readEngineFile(engineFor(request.owner, request.engineId), request.name);
      case 'terminate': {
        const engine = engines.get(request.engineId);
        if (engine && engine.owner === request.owner) await serially(() => closeEngine(engine));
        return null;
      }
      case 'release-owner':
        await serially(() => releaseOwner(request.owner));
        return null;
      case 'dispose':
        await serially(() => dispose());
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

  async function dispose(): Promise<void> {
    await Promise.all([...engines.values()].map(closeEngine));
  }

  return {
    async handle(request: LocalRequest): Promise<LocalResponse> {
      try {
        return { id: request.id, ok: true, result: await handle(request) };
      } catch (error) {
        const code = error instanceof LocalError ? error.code : undefined;
        const folders = 'owner' in request ? filesDirsOf(request.owner) : [];
        return { id: request.id, ok: false, error: { message: messageOf(error, folders), ...(code ? { code } : {}) } };
      }
    },
    dispose,
  };
}

export type SqlLocalEngine = ReturnType<typeof createSqlLocalEngine>;
