import type { Language, LanguageRunner, ExecutionContext, ExecutionResult } from '../types';
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
  private runners: Map<Language, LanguageRunner> = new Map();
  private initializing: Map<Language, Promise<void>> = new Map();

  constructor() {
    this.runners.set('javascript', new JavaScriptRunner());
    this.runners.set('typescript', new TypeScriptRunner());
    this.runners.set('go', new GoRunner());
    this.runners.set('python', new PythonRunner());
    this.runners.set('rust', new RustRunner());
  }

  /** Get the runner for a given language, initializing if needed */
  async getRunner(language: Language): Promise<LanguageRunner | null> {
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
    language: Language,
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult> {
    const runner = await this.getRunner(language);

    if (runner) {
      return runner.execute(code, context);
    }

    // Fall back to plugin registry for languages not built in
    const plugin = pluginRegistry.getByLanguage(language);
    if (plugin) {
      // Create and cache the plugin runner so it's initialized only once
      const pluginRunner = await plugin.createRunner();
      await pluginRunner.init();
      // Store under the language key for future calls
      this.runners.set(language as Language, pluginRunner as unknown as import('../types').LanguageRunner);
      return pluginRunner.execute(code, context);
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
  stop(language: Language): void {
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
  isSupported(language: Language): boolean {
    return this.runners.has(language);
  }

  /** Get list of supported languages */
  getSupportedLanguages(): Language[] {
    return Array.from(this.runners.keys());
  }
}

/** Singleton instance */
export const runnerManager = new RunnerManager();
