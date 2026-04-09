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

const DEFAULT_TIMEOUT = 60_000; // Python needs more time for initial load

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
        { type: 'classic' }
      );
    }

    if (!this.loadingPromise) {
      this.loadingPromise = new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg.type === 'ready') {
            this.pyodideLoaded = true;
            this.worker?.removeEventListener('message', handler);
            resolve();
          } else if (msg.type === 'error') {
            this.worker?.removeEventListener('message', handler);
            reject(new Error(msg.error?.message ?? 'Failed to load Pyodide'));
          }
        };
        this.worker!.addEventListener('message', handler);
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

    // Transform magic comments before execution
    const hasMagic = detectPythonMagicComments(code).length > 0;
    const transformedCode = hasMagic ? transformPythonMagicComments(code) : code;

    return new Promise<ExecutionResult>((resolve) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = { type: msg.method, args: msg.args };
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
      worker.postMessage({ type: 'execute', code: transformedCode, timeout });
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
