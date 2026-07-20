/**
 * implementation — renderer-side wrapper for the Pyodide worker's
 * dependency-management protocol.
 *
 * Mirrors the shape `window.lingua.dependencies.installJs / cancel /
 * onInstallLog` exposes on the desktop JS/TS side , but the
 * transport is a Web Worker postMessage protocol instead of an
 * Electron IPC. The worker handlers live in
 * `src/renderer/workers/python-worker.ts` under message types
 * `dependencies:list-loaded` and `dependencies:install`.
 *
 * The installer SHARES the Pyodide worker with `PythonRunner` so the
 * packages it installs are visible to the user's `Run` action
 * immediately after — there is one Pyodide runtime per session. The
 * shared accessor is `runnerManager.getPythonRunner()?.getOrEnsurePyodideWorker()`.
 *
 * implementation note in this surface:
 *
 *   - C — `listLoadedPackages()` queries `pyodide.loadedPackages` so
 *     the renderer can mark Pyodide builtins (`numpy`, `pandas`,
 *     `requests` on some Pyodide builds) as `'installed'` from boot
 *     instead of lying with `'detected'`.
 *   - F — 90s soft timeout via `Promise.race` so a hung `micropip`
 *     frees the runId and surfaces `'timed-out'` instead of blocking
 *     the panel forever.
 *
 * Out of scope :
 *
 *   - Hard cancel mid-install. Pyodide doesn't expose mid-microtask
 *     kill semantics; honest cancel needs a fresh worker which
 *     defeats the shared-runtime principle. Soft cancel UX (implementation note)
 *     was considered and rejected for implementation.
 *   - Coalescing rapid clicks (implementation note rejected). Each click on a
 *     Python row triggers its own install round-trip.
 */

import type {
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
} from '../../shared/dependencies/types';
import { runnerManager } from '../runners';

export type PythonInstallStream = 'stdout' | 'stderr';

export interface PythonInstallLogChunk {
  readonly runId: string;
  readonly stream: PythonInstallStream;
  readonly chunk: string;
}

/**
 * Reviewer fix — alias to the global ambient `DependencyInstallResultStatus`
 * (declared in `src/types.d.ts` from the JS/TS desktop install IPC
 * contract). Both shapes coincide today, but aliasing keeps them
 * structurally linked: a future widening of one type propagates to
 * the other, and `mapInstallStatusToDependencyStatus` in
 * `dependencyDetectionStore.ts` continues to receive the type it
 * was designed for.
 */
export type PythonInstallResultStatus = DependencyInstallResultStatus;

export interface PythonInstallResult {
  readonly statuses: Record<string, PythonInstallResultStatus>;
  readonly outcome: DependencyInstallOutcome;
  readonly failureReason: DependencyInstallFailureReason | null;
}

/**
 * Worker-side fail timeout. The Python worker has no native
 * micropip timeout primitive, so the renderer races a 90 s deadline
 * against the install promise. After the race the worker microtask
 * keeps running but its postMessage replies are dropped (we delete
 * the pending entry).
 */
const INSTALL_TIMEOUT_MS = 90 * 1000;

interface PendingInstall {
  readonly resolve: (value: PythonInstallResult) => void;
  readonly onLog: ((chunk: PythonInstallLogChunk) => void) | undefined;
  /**
   * Reviewer fix — clearTimeout handle so the install promise winning
   * the `Promise.race` against the 90 s timeout cancels the
   * setTimeout instead of letting it fire 90 s later as a no-op
   * (which still ticks the event loop + may delete a freshly-reused
   * runId if the same string round-trips).
   */
  cancelTimeout?: () => void;
}

const pendingInstalls = new Map<string, PendingInstall>();
const pendingLoadedQueries = new Map<
  string,
  (packages: readonly string[]) => void
>();

let listenerInstalled = false;
let listenerWorker: Worker | null = null;

interface WorkerMessage {
  readonly type?: unknown;
  readonly runId?: unknown;
  readonly requestId?: unknown;
  readonly stream?: unknown;
  readonly chunk?: unknown;
  readonly statuses?: unknown;
  readonly outcome?: unknown;
  readonly failureReason?: unknown;
  readonly packages?: unknown;
}

function dispatchWorkerMessage(event: MessageEvent): void {
  const data = event.data as WorkerMessage;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'dependencies:install:log') {
    if (typeof data.runId !== 'string') return;
    const entry = pendingInstalls.get(data.runId);
    if (!entry || !entry.onLog) return;
    if (
      typeof data.chunk !== 'string' ||
      (data.stream !== 'stdout' && data.stream !== 'stderr')
    ) {
      return;
    }
    entry.onLog({
      runId: data.runId,
      stream: data.stream,
      chunk: data.chunk,
    });
    return;
  }
  if (data.type === 'dependencies:install:done') {
    if (typeof data.runId !== 'string') return;
    const entry = pendingInstalls.get(data.runId);
    if (!entry) return;
    pendingInstalls.delete(data.runId);
    entry.cancelTimeout?.();
    // Reviewer fix — validate each per-name status against the
    // closed enum before passing the map upstream. A malformed
    // worker message (Pyodide version mismatch, fuzz, etc.) cannot
    // smuggle unexpected strings into the renderer's status map and
    // crash the `mapInstallStatusToDependencyStatus` exhaustive
    // switch at runtime.
    const allowedStatuses: ReadonlySet<PythonInstallResultStatus> = new Set([
      'installed',
      'failed',
      'cancelled',
      'skipped-preflight',
    ]);
    const statuses: Record<string, PythonInstallResultStatus> = {};
    if (data.statuses && typeof data.statuses === 'object') {
      for (const [name, raw] of Object.entries(
        data.statuses as Record<string, unknown>
      )) {
        if (typeof raw !== 'string') continue;
        if (!allowedStatuses.has(raw as PythonInstallResultStatus)) continue;
        statuses[name] = raw as PythonInstallResultStatus;
      }
    }
    const outcome =
      typeof data.outcome === 'string'
        ? (data.outcome as DependencyInstallOutcome)
        : ('failed' as DependencyInstallOutcome);
    const failureReason =
      typeof data.failureReason === 'string'
        ? (data.failureReason as DependencyInstallFailureReason)
        : null;
    entry.resolve({ statuses, outcome, failureReason });
    return;
  }
  if (data.type === 'dependencies:list-loaded:reply') {
    if (typeof data.requestId !== 'string') return;
    const resolve = pendingLoadedQueries.get(data.requestId);
    if (!resolve) return;
    pendingLoadedQueries.delete(data.requestId);
    const packages = Array.isArray(data.packages)
      ? (data.packages as unknown[]).filter(
          (entry): entry is string => typeof entry === 'string'
        )
      : [];
    resolve(packages);
  }
}

function ensureListener(worker: Worker): void {
  if (listenerInstalled && listenerWorker === worker) return;
  if (listenerWorker && listenerWorker !== worker) {
    // Worker was replaced (Pyodide boot failed + retried). Drop any
    // pending listeners on the old worker first.
    listenerWorker.removeEventListener('message', dispatchWorkerMessage);
    // Reviewer fix — drain pending requests against the old worker
    // so the panel doesn't wait 90 s for the soft timeout to free
    // each runId. Any in-flight install gets a `failed/unknown`
    // result immediately so the renderer can flip its rows back to
    // `'detected'` and let the user retry against the new worker.
    for (const [runId, entry] of pendingInstalls) {
      entry.cancelTimeout?.();
      entry.resolve({
        statuses: {},
        outcome: 'failed',
        failureReason: 'unknown',
      });
      void runId;
    }
    pendingInstalls.clear();
    for (const [requestId, resolve] of pendingLoadedQueries) {
      resolve([]);
      void requestId;
    }
    pendingLoadedQueries.clear();
  }
  worker.addEventListener('message', dispatchWorkerMessage);
  listenerInstalled = true;
  listenerWorker = worker;
}

/**
 * Lazily acquire the shared Pyodide worker through the runner so the
 * installer and the user's Run path share one runtime. Returns null
 * when Python isn't a registered language pack (defensive — should
 * never happen in production).
 */
async function getSharedWorker(): Promise<Worker | null> {
  const runner = runnerManager.getPythonRunner();
  if (!runner) return null;
  try {
    return await runner.getOrEnsurePyodideWorker();
  } catch {
    return null;
  }
}

/**
 * implementation Slice C (implementation note) — query Pyodide for the set of currently-
 * loaded packages so the renderer can mark them as `'installed'`
 * honestly. Returns an empty array if the worker isn't ready (the
 * hook falls back to `'detected'` for every name).
 */
export async function listLoadedPackages(): Promise<readonly string[]> {
  const worker = await getSharedWorker();
  if (!worker) return [];
  ensureListener(worker);
  const requestId = `loaded-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return new Promise<readonly string[]>((resolve) => {
    let timer: number | null = null;
    const settle = (value: readonly string[]) => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      pendingLoadedQueries.delete(requestId);
      resolve(value);
    };
    pendingLoadedQueries.set(requestId, settle);
    // 5 s soft timeout — if Pyodide is slow to answer, the hook
    // treats the response as empty (every detected name becomes
    // `'detected'`), which is the same UX we had before implementation
    // shipped. The timer handle is captured + cleared on early
    // resolve so a worker reply that wins the race does not leak a
    // pending setTimeout.
    timer = window.setTimeout(() => {
      if (pendingLoadedQueries.delete(requestId)) {
        resolve([]);
      }
    }, 5_000);
    worker.postMessage({
      type: 'dependencies:list-loaded',
      requestId,
    });
  });
}

/**
 * implementation — install one or more packages via `micropip` in
 * the shared Pyodide worker.
 *
 * implementation note applies — the renderer races the install promise against a
 * 90 s timeout so a hung micropip frees the runId. The worker keeps
 * running in the background; we just stop tracking the result.
 */
export async function installPython(args: {
  readonly runId: string;
  readonly specifiers: readonly string[];
  readonly onLog?: (chunk: PythonInstallLogChunk) => void;
}): Promise<PythonInstallResult> {
  const { runId, specifiers, onLog } = args;
  const worker = await getSharedWorker();
  if (!worker) {
    const statuses: Record<string, PythonInstallResultStatus> = {};
    for (const name of specifiers) statuses[name] = 'failed';
    return {
      statuses,
      outcome: 'failed',
      failureReason: 'unknown',
    };
  }
  ensureListener(worker);

  // Reviewer fix — share the timer between the install promise and
  // the timeout promise so whichever resolves first cancels the
  // other side. Avoids leaking a 90 s timer per install when the
  // worker replies normally.
  let timeoutTimer: number | null = null;
  const cancelTimeout = (): void => {
    if (timeoutTimer !== null) {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  };

  const installPromise = new Promise<PythonInstallResult>((resolve) => {
    pendingInstalls.set(runId, { resolve, onLog, cancelTimeout });
    worker.postMessage({
      type: 'dependencies:install',
      runId,
      specifiers,
    });
  });

  const timeoutPromise = new Promise<PythonInstallResult>((resolve) => {
    timeoutTimer = window.setTimeout(() => {
      timeoutTimer = null;
      if (pendingInstalls.delete(runId)) {
        const statuses: Record<string, PythonInstallResultStatus> = {};
        for (const name of specifiers) statuses[name] = 'failed';
        resolve({
          statuses,
          outcome: 'timed-out',
          failureReason: 'timeout',
        });
      }
    }, INSTALL_TIMEOUT_MS);
  });

  return Promise.race([installPromise, timeoutPromise]);
}

/**
 * Test seam — exported only so unit tests can reset module state
 * between cases without re-importing.
 */
export function __resetPythonInstallerForTests(): void {
  pendingInstalls.clear();
  pendingLoadedQueries.clear();
  if (listenerWorker) {
    listenerWorker.removeEventListener('message', dispatchWorkerMessage);
  }
  listenerInstalled = false;
  listenerWorker = null;
}
