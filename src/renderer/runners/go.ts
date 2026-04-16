import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  WorkerResponse,
} from '../types';

const DEFAULT_TIMEOUT = 30_000;

export class GoRunner implements LanguageRunner {
  id = 'go';
  name = 'Go';
  language = 'go' as const;
  extensions = ['.go'];

  private worker: Worker | null = null;
  private ready = false;
  private goInstalled = false;

  async init(): Promise<void> {
    // Check if Go is installed via IPC
    const result = await window.lingua.go.detect();
    this.goInstalled = result.installed;
    this.ready = true;

    if (!result.installed) {
      throw new Error(result.error ?? 'Go is not installed.');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;

    if (!this.goInstalled) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message:
            'Go is not installed on this system. Install Go from https://go.dev/dl/ and restart Lingua.',
        },
      };
    }

    // Step 1: Compile Go to WASM via IPC (main process)
    const compileResult = await window.lingua.go.compile(code);

    if (!compileResult.success || !compileResult.wasmBytes || !compileResult.wasmExecJs) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: compileResult.error ?? 'Go compilation failed.',
          ...parseGoError(compileResult.error),
        },
      };
    }

    // Step 2: Execute the WASM in a Web Worker
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let error: ExecutionError | undefined;

    this.stop();

    return new Promise<ExecutionResult>((resolve) => {
      this.worker = new Worker(
        new URL('../workers/go-worker.ts', import.meta.url),
        { type: 'classic' }
      );

      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
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
          case 'error':
            error = msg.error;
            break;
          case 'done':
            resolve({
              stdout,
              stderr,
              result: undefined,
              executionTime: msg.executionTime,
              error,
            });
            break;
        }
      });

      this.worker.addEventListener('error', (event) => {
        resolve({
          stdout,
          stderr,
          result: undefined,
          executionTime: 0,
          error: { message: event.message || 'Go worker error' },
        });
      });

      this.worker.postMessage({
        type: 'execute',
        wasmBytes: compileResult.wasmBytes,
        wasmExecJs: compileResult.wasmExecJs,
        timeout,
      });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/** Try to extract line/column from Go compiler error messages */
function parseGoError(errorMsg?: string): { line?: number; column?: number } {
  if (!errorMsg) return {};

  // Go errors format: "./main.go:LINE:COL: error message"
  const match = errorMsg.match(/main\.go:(\d+):(\d+):/);
  const lineValue = match?.[1];
  const columnValue = match?.[2];
  if (lineValue && columnValue) {
    return {
      line: parseInt(lineValue, 10),
      column: parseInt(columnValue, 10),
    };
  }
  return {};
}
