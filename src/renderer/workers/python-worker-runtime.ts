import type { DependencyInstallFailureReason } from '../../shared/dependencies/types';
import { drainResponseBody, responseWithBootstrapProgress } from './bootstrapProgress';
import type { PythonWorkerPort } from './python-worker-protocol';

export type PyodidePyModule = {
  install?: (packages: unknown) => Promise<unknown> | unknown;
  destroy?: () => void;
};

export type PyodideRuntime = {
  runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>;
  runPython?(code: string): unknown;
  loadPackage?: (names: string | readonly string[]) => Promise<unknown>;
  loadedPackages?: Record<string, unknown>;
  pyimport?: (name: string) => PyodidePyModule;
  toPy?: (value: unknown) => unknown;
  setStdout?: (options: { batched: (text: string) => void }) => void;
  setStderr?: (options: { batched: (text: string) => void }) => void;
  setStdin?: (options?: {
    stdin?: () => string | null | undefined;
    error?: boolean;
    isatty?: boolean;
  }) => void;
  globals: {
    set(name: string, value: unknown): void;
    get?(name: string): unknown;
    delete?(name: string): void;
  };
};

type PyodideLoaderModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<unknown>;
};

export interface PythonRuntimeAdapter {
  loadPyodide(): Promise<PyodideRuntime>;
  ensureMicropip(): Promise<PyodidePyModule>;
  setActiveRunId(runId: string | null): void;
  resetStdin(): void;
}

// Keep this URL resolution inside the runtime adapter. The stable worker
// entrypoint must remain transport-only, while Vite still resolves the local
// Pyodide directory relative to this emitted worker chunk.
const RAW_PYODIDE_INDEX_URL = new URL(/* @vite-ignore */ '../pyodide/', import.meta.url).href;

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolvePyodideIndexUrl(): string {
  const configuredUrl =
    typeof __LINGUA_PYODIDE_INDEX_URL__ === 'string' ? __LINGUA_PYODIDE_INDEX_URL__.trim() : '';
  return withTrailingSlash(configuredUrl || RAW_PYODIDE_INDEX_URL);
}

const PYODIDE_INDEX_URL = resolvePyodideIndexUrl();

export function createPythonRuntimeAdapter(ctx: PythonWorkerPort): PythonRuntimeAdapter {
  let pyodide: PyodideRuntime | null = null;
  let activeRunId: string | null = null;
  let micropipLoadPromise: Promise<PyodidePyModule> | null = null;

  /** Best-effort WASM cache pre-warm with live byte progress. */
  const prewarmPyodideWithProgress = async (): Promise<void> => {
    try {
      const response = await fetch(`${PYODIDE_INDEX_URL}pyodide.asm.wasm`);
      if (!response.ok || !response.body) return;
      const trackedResponse = responseWithBootstrapProgress(
        response,
        ({ loadedBytes, totalBytes }) => {
          ctx.postMessage({
            type: 'bootstrap-progress',
            runId: activeRunId ?? '',
            loadedBytes,
            totalBytes,
          });
        }
      );
      await drainResponseBody(trackedResponse);
    } catch {
      // The real loader below reports failures; pre-warm is optional.
    }
  };

  const loadPyodide = async (): Promise<PyodideRuntime> => {
    if (pyodide) return pyodide;
    await prewarmPyodideWithProgress();

    const loader = (await import(
      /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
    )) as PyodideLoaderModule;
    pyodide = (await loader.loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
    })) as PyodideRuntime;

    pyodide.setStdout?.({
      batched: (text: string) => {
        if (text.length > 0 && activeRunId) {
          ctx.postMessage({
            type: 'console',
            runId: activeRunId,
            method: 'log',
            args: [text],
          });
        }
      },
    });
    pyodide.setStderr?.({
      batched: (text: string) => {
        if (text.length > 0 && activeRunId) {
          ctx.postMessage({
            type: 'console',
            runId: activeRunId,
            method: 'error',
            args: [text],
          });
        }
      },
    });

    return pyodide;
  };

  const ensureMicropip = async (): Promise<PyodidePyModule> => {
    if (micropipLoadPromise) return micropipLoadPromise;
    micropipLoadPromise = (async () => {
      const runtime = await loadPyodide();
      if (typeof runtime.loadPackage !== 'function' || typeof runtime.pyimport !== 'function') {
        throw new Error('Pyodide runtime missing loadPackage / pyimport');
      }
      await runtime.loadPackage('micropip');
      const module = runtime.pyimport('micropip');
      if (!module || typeof module.install !== 'function') {
        throw new Error('Failed to load micropip (missing install)');
      }
      return module;
    })().catch(error => {
      // A failed load must remain retryable.
      micropipLoadPromise = null;
      throw error;
    });
    return micropipLoadPromise;
  };

  return {
    loadPyodide,
    ensureMicropip,
    setActiveRunId(runId) {
      activeRunId = runId;
    },
    resetStdin() {
      pyodide?.setStdin?.();
    },
  };
}

export function classifyMicropipError(message: string): DependencyInstallFailureReason {
  const lower = message.toLowerCase();
  if (
    lower.includes("can't find a pure python 3 wheel") ||
    lower.includes('is not a pure python 3 wheel') ||
    lower.includes('no binary distribution') ||
    lower.includes('no compatible wheel') ||
    lower.includes('requires extension build') ||
    lower.includes('no matching distribution')
  ) {
    return 'unsupported-wheel';
  }
  return 'unknown';
}
