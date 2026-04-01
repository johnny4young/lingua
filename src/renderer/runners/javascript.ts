import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  WorkerResponse,
} from '../types';

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

export class JavaScriptRunner implements LanguageRunner {
  id = 'javascript';
  name = 'JavaScript';
  language = 'javascript' as const;
  extensions = ['.js', '.mjs'];

  private worker: Worker | null = null;
  private ready = false;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;

    // Terminate any previous worker
    this.stop();

    return new Promise<ExecutionResult>((resolve) => {
      // Create a new worker for each execution (clean state)
      this.worker = new Worker(
        new URL('../workers/js-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = {
              type: msg.method,
              args: msg.args,
            };
            if (msg.method === 'error') {
              stderr.push(output);
            } else {
              stdout.push(output);
            }
            break;
          }
          case 'result':
            result = msg.value;
            break;
          case 'error':
            error = msg.error;
            break;
          case 'done':
            resolve({
              stdout,
              stderr,
              result,
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
          error: {
            message: event.message || 'Worker error',
          },
        });
      });

      // Send execution request
      this.worker.postMessage({ type: 'execute', code, timeout });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
