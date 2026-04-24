import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  MagicCommentResult,
  WorkerResponse,
} from '../types';
import { transformPythonMagicComments, detectPythonMagicComments } from '../utils/magicComments';
import { injectPythonLoopProtection } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveUserEnvForRunner } from './go';

const DEFAULT_TIMEOUT = 60_000; // Python needs more time for initial load
const PYODIDE_LOAD_TIMEOUT = 90_000;

function workerLoadErrorMessage(event: Event): string {
  const maybeMessage = (event as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.length > 0
    ? maybeMessage
    : 'Python worker failed to load';
}

export class PythonRunner implements LanguageRunner {
  id = 'python';
  name = 'Python (Pyodide)';
  language = 'python' as const;
  extensions = ['.py'];

  private worker: Worker | null = null;
  private ready = false;
  private pyodideLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    this.ready = true;
    // Pyodide is loaded lazily on first execution
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Ensure Pyodide is loaded in the worker */
  private async ensurePyodide(): Promise<Worker> {
    if (this.worker && this.pyodideLoaded) {
      return this.worker;
    }

    // Create a persistent worker for Python (Pyodide takes time to load)
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/python-worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    if (!this.loadingPromise) {
      this.loadingPromise = new Promise<void>((resolve, reject) => {
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | null =
          globalThis.setTimeout(() => {
            cleanup();
            this.worker?.terminate();
            this.worker = null;
            this.pyodideLoaded = false;
            this.loadingPromise = null;
            reject(new Error(`Timed out loading Pyodide after ${PYODIDE_LOAD_TIMEOUT / 1000}s`));
          }, PYODIDE_LOAD_TIMEOUT);

        const cleanup = () => {
          this.worker?.removeEventListener('message', handler);
          this.worker?.removeEventListener('error', errorHandler);
          if (timeoutId !== null) {
            globalThis.clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg.type === 'ready') {
            this.pyodideLoaded = true;
            cleanup();
            resolve();
          } else if (msg.type === 'error') {
            cleanup();
            reject(new Error(msg.error?.message ?? 'Failed to load Pyodide'));
          }
        };

        const errorHandler = (event: Event) => {
          cleanup();
          this.worker?.terminate();
          this.worker = null;
          this.pyodideLoaded = false;
          this.loadingPromise = null;
          reject(new Error(workerLoadErrorMessage(event)));
        };

        this.worker!.addEventListener('message', handler);
        this.worker!.addEventListener('error', errorHandler);
        this.worker!.postMessage({ type: 'init' });
      });
    }

    await this.loadingPromise;
    return this.worker;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;

    let worker: Worker;
    try {
      worker = await this.ensurePyodide();
    } catch (err) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: `Failed to load Python runtime: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    // Apply loop protection if enabled
    const { loopProtection, maxLoopIterations } = useSettingsStore.getState();
    const processedCode = loopProtection ? injectPythonLoopProtection(code, maxLoopIterations) : code;

    // Transform magic comments before execution
    const hasMagic = detectPythonMagicComments(processedCode).length > 0;
    const transformedCode = hasMagic ? transformPythonMagicComments(processedCode) : processedCode;

    return new Promise<ExecutionResult>((resolve) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = { type: msg.method, args: msg.args, line: msg.line };
            if (msg.method === 'error') {
              stderr.push(output);
            } else {
              stdout.push(output);
            }
            break;
          }
          case 'magic-comment':
            magicResults.push({ line: msg.line, value: msg.value });
            break;
          case 'result':
            result = msg.value;
            break;
          case 'error':
            error = msg.error;
            break;
          case 'done':
            worker.removeEventListener('message', handler);
            resolve({
              stdout,
              stderr,
              result,
              executionTime: msg.executionTime,
              error,
              magicResults: magicResults.length > 0 ? magicResults : undefined,
            });
            break;
        }
      };

      worker.addEventListener('message', handler);
      // RL-011 Slice D third increment — pipe the resolved user env
      // into the Pyodide worker so user code's `os.environ` reflects
      // the global / project / tab tiers. Empty record keeps the
      // worker's fast path untouched.
      const userEnv = resolveUserEnvForRunner();
      worker.postMessage({
        type: 'execute',
        code: transformedCode,
        timeout,
        userEnv,
      });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pyodideLoaded = false;
      this.loadingPromise = null;
    }
  }
}
