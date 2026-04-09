import * as esbuild from 'esbuild-wasm';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  MagicCommentResult,
  WorkerResponse,
} from '../types';
import { transformJSMagicComments, detectJSMagicComments } from '../utils/magicComments';

const DEFAULT_TIMEOUT = 30_000;

let esbuildInitialized = false;

export class TypeScriptRunner implements LanguageRunner {
  id = 'typescript';
  name = 'TypeScript';
  language = 'typescript' as const;
  extensions = ['.ts', '.tsx'];

  private worker: Worker | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (!esbuildInitialized) {
      await esbuild.initialize({
        wasmURL: new URL('esbuild-wasm/esbuild.wasm', import.meta.url).href,
      });
      esbuildInitialized = true;
    }
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Transpile TypeScript to JavaScript using esbuild-wasm */
  private async transpile(code: string): Promise<{ js: string; error?: ExecutionError }> {
    try {
      const result = await esbuild.transform(code, {
        loader: 'tsx',
        target: 'es2022',
        format: 'esm',
        sourcemap: false,
      });

      if (result.warnings.length > 0) {
        // Warnings are not fatal; just log them
        for (const w of result.warnings) {
          console.warn(`[esbuild] ${w.text}`);
        }
      }

      return { js: result.code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Try to parse esbuild error for line/column info
      const lineMatch = message.match(/(\d+):(\d+)/);
      const lineValue = lineMatch?.[1];
      const columnValue = lineMatch?.[2];
      return {
        js: '',
        error: {
          message: `TypeScript transpilation error: ${message}`,
          line: lineValue ? parseInt(lineValue, 10) : undefined,
          column: columnValue ? parseInt(columnValue, 10) : undefined,
        },
      };
    }
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;

    // Step 1: Transform magic comments before transpilation
    // (esbuild would strip the //=> comments during transpilation)
    const hasMagic = detectJSMagicComments(code).length > 0;
    const codeForTranspile = hasMagic ? transformJSMagicComments(code) : code;

    // Step 2: Transpile TS -> JS
    const { js, error: transpileError } = await this.transpile(codeForTranspile);

    if (transpileError) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: transpileError,
      };
    }

    // Step 3: Execute the transpiled JS using the same JS worker
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;

    this.stop();

    return new Promise<ExecutionResult>((resolve) => {
      this.worker = new Worker(
        new URL('../workers/js-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
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
      });

      this.worker.addEventListener('error', (event) => {
        resolve({
          stdout,
          stderr,
          result: undefined,
          executionTime: 0,
          error: { message: event.message || 'Worker error' },
        });
      });

      this.worker.postMessage({ type: 'execute', code: js, timeout });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
