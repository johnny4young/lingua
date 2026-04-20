import type { LanguageRunner, ExecutionContext, ExecutionResult } from '../types';
import { JavaScriptRunner } from './javascript';
import { TypeScriptRunner } from './typescript';
import { GoRunner } from './go';
import { PythonRunner } from './python';
import { RustRunner } from './rust';
import { pluginRegistry } from '../plugins';
import { LANGUAGE_PACKS } from '../../shared/languagePacks';

export interface RunnerPreparationResult {
  runner: LanguageRunner | null;
  initialized: boolean;
}

/**
 * Built-in runner factories keyed by `LanguagePack.runnerId` (RL-038 Slice B).
 *
 * The `RunnerManager` constructor walks `LANGUAGE_PACKS`, finds every pack
 * whose `runnerId` is present in this map, and instantiates the factory.
 * Packs whose `runnerId` is absent from the map (today: `lua`) intentionally
 * fall through to the plugin registry — Slice B is additive, not a
 * pluginRegistry replacement.
 */
const BUILT_IN_RUNNER_FACTORIES: Record<string, () => LanguageRunner> = {
  javascript: () => new JavaScriptRunner(),
  typescript: () => new TypeScriptRunner(),
  go: () => new GoRunner(),
  python: () => new PythonRunner(),
  rust: () => new RustRunner(),
};

/**
 * RunnerManager orchestrates language runners.
 * Selects the appropriate runner based on language, manages lifecycle,
 * and provides a unified execution API.
 */
export class RunnerManager {
  private runners: Map<string, LanguageRunner> = new Map();
  private initializing: Map<string, Promise<void>> = new Map();

  constructor() {
    for (const pack of LANGUAGE_PACKS) {
      if (pack.runnerId === null) continue;
      const factory = BUILT_IN_RUNNER_FACTORIES[pack.runnerId];
      if (!factory) continue;
      this.runners.set(pack.id, factory());
    }
  }

  private async ensureRunner(language: string): Promise<LanguageRunner | null> {
    const plugin = pluginRegistry.getByLanguage(language);

    if (!this.runners.has(language) && plugin) {
      const pluginRunner = await plugin.createRunner();
      this.runners.set(language, pluginRunner as unknown as LanguageRunner);
    }

    return this.runners.get(language) ?? null;
  }

  private async initializeRunner(language: string, runner: LanguageRunner): Promise<void> {
    if (!this.initializing.has(language)) {
      const initPromise = runner.init().finally(() => {
        this.initializing.delete(language);
      });
      this.initializing.set(language, initPromise);
    }

    const pendingInitialization = this.initializing.get(language);
    if (pendingInitialization) {
      await pendingInitialization;
    }
  }

  /** Check whether preparing a language will trigger initialization */
  needsInitialization(language: string): boolean {
    if (this.initializing.has(language)) {
      return true;
    }

    const runner = this.runners.get(language);
    if (runner) {
      return !runner.isReady();
    }

    return pluginRegistry.hasLanguage(language);
  }

  /** Prepare the runner for execution, initializing it if needed */
  async prepareRunner(language: string): Promise<RunnerPreparationResult> {
    const runner = await this.ensureRunner(language);
    if (!runner) {
      return { runner: null, initialized: false };
    }

    const initialized = !runner.isReady();
    if (initialized) {
      await this.initializeRunner(language, runner);
    }

    return { runner, initialized };
  }

  /** Get the runner for a given language, initializing if needed */
  async getRunner(language: string): Promise<LanguageRunner | null> {
    const { runner } = await this.prepareRunner(language);
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
