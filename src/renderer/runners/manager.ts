import type { LanguageRunner, ExecutionContext, ExecutionResult } from '../types';
import { JavaScriptRunner } from './javascript';
import { TypeScriptRunner } from './typescript';
import { GoRunner } from './go';
import { PythonRunner } from './python';
import { RustRunner } from './rust';
import { pluginRegistry } from '../plugins';

/**
 * RunnerManager orchestrates language runners.
 * Selects the appropriate runner based on language, manages lifecycle,
 * and provides a unified execution API.
 */
export class RunnerManager {
  private runners: Map<string, LanguageRunner> = new Map();
  private initializing: Map<string, Promise<void>> = new Map();

  constructor() {
    this.runners.set('javascript', new JavaScriptRunner());
    this.runners.set('typescript', new TypeScriptRunner());
    this.runners.set('go', new GoRunner());
    this.runners.set('python', new PythonRunner());
    this.runners.set('rust', new RustRunner());
  }

  /** Get the runner for a given language, initializing if needed */
  async getRunner(language: string): Promise<LanguageRunner | null> {
    const plugin = pluginRegistry.getByLanguage(language);

    if (!this.runners.has(language) && plugin) {
      const pluginRunner = await plugin.createRunner();
      this.runners.set(language, pluginRunner as unknown as LanguageRunner);
    }

    const runner = this.runners.get(language);
    if (!runner) return null;

    if (!runner.isReady()) {
      // Avoid double-initialization
      if (!this.initializing.has(language)) {
        const initPromise = runner.init().then(() => {
          this.initializing.delete(language);
        });
        this.initializing.set(language, initPromise);
      }
      await this.initializing.get(language);
    }

    return runner;
  }

  /** Execute code in the appropriate language runner */
  async execute(
    language: string,
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult> {
    const runner = await this.getRunner(language);

    if (runner) {
      return runner.execute(code, context);
    }

    return {
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 0,
      error: {
        message: `No runner available for ${language}. It will be added in a future update.`,
      },
    };
  }

  /** Stop execution for a given language */
  stop(language: string): void {
    const runner = this.runners.get(language);
    if (runner) {
      runner.stop();
    }
  }

  /** Stop all runners */
  stopAll(): void {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
  }

  /** Check if a language is supported */
  isSupported(language: string): boolean {
    return this.runners.has(language) || pluginRegistry.hasLanguage(language);
  }

  /** Get list of supported languages */
  getSupportedLanguages(): string[] {
    return Array.from(new Set([
      ...this.runners.keys(),
      ...pluginRegistry.getAll().map((plugin) => plugin.language),
    ]));
  }
}

/** Singleton instance */
export const runnerManager = new RunnerManager();
