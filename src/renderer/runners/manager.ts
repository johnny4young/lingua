import type { LanguageRunner, ExecutionContext, ExecutionResult } from '../types';
import { JavaScriptRunner } from './javascript';
import { TypeScriptRunner } from './typescript';
import { GoRunner } from './go';
import { PythonRunner } from './python';
import { RustRunner } from './rust';
import { BrowserPreviewRunner } from './browserPreview';
import { NodeRunner } from './nodeRunner';
import { pluginRegistry } from '../plugins';
import { LANGUAGE_PACKS } from '../../shared/languagePacks';
import type { RuntimeMode } from '../../shared/runtimeModes';
import { languageHasRuntimeModes } from '../../shared/runtimeModes';

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
  /**
   * RL-019 Slice 3 — runtime-mode-aware runners that override the
   * default language-keyed dispatch when the active tab carries an
   * explicit `runtimeMode`. The keys mirror the implemented
   * RuntimeMode values; `'worker'` intentionally has no entry so
   * the default language-keyed path stays the source of truth for
   * the JS Worker, TS Worker, Python Pyodide worker, etc.
   */
  private runtimeModeRunners: Map<string, LanguageRunner> = new Map<
    string,
    LanguageRunner
  >([
    ['browser-preview', new BrowserPreviewRunner()],
    // RL-019 Slice 2 — desktop Node child-spawn runner. Self-gates
    // on `window.lingua.node` availability inside `.execute()`
    // (web builds surface a clear renderer-side error instead of
    // crashing the manager registration on import).
    ['node', new NodeRunner()],
  ]);
  private runtimeModeInitializing: Map<string, Promise<void>> = new Map();

  constructor() {
    for (const pack of LANGUAGE_PACKS) {
      if (pack.runnerId === null) continue;
      const factory = BUILT_IN_RUNNER_FACTORIES[pack.runnerId];
      if (!factory) continue;
      this.runners.set(pack.id, factory());
    }
  }

  /**
   * Resolve the active runner for the given language + optional
   * runtime mode. When the runtime mode names an implemented
   * override AND the language owns the runtime-mode surface
   * (JS / TS today), the runtime-mode runner wins. Otherwise we
   * fall through to the language-keyed default.
   */
  private resolveRunnerKey(
    language: string,
    runtimeMode: RuntimeMode | undefined
  ): { kind: 'runtime-mode'; mode: RuntimeMode } | { kind: 'language'; language: string } {
    if (
      runtimeMode &&
      runtimeMode !== 'worker' &&
      languageHasRuntimeModes(language) &&
      this.runtimeModeRunners.has(runtimeMode)
    ) {
      return { kind: 'runtime-mode', mode: runtimeMode };
    }
    return { kind: 'language', language };
  }

  private async ensureRunner(
    language: string,
    runtimeMode?: RuntimeMode
  ): Promise<LanguageRunner | null> {
    const key = this.resolveRunnerKey(language, runtimeMode);
    if (key.kind === 'runtime-mode') {
      return this.runtimeModeRunners.get(key.mode) ?? null;
    }
    const plugin = pluginRegistry.getByLanguage(language);

    if (!this.runners.has(language) && plugin) {
      const pluginRunner = await plugin.createRunner();
      this.runners.set(language, pluginRunner as unknown as LanguageRunner);
    }

    return this.runners.get(language) ?? null;
  }

  private async initializeRunner(
    cacheKey: string,
    runner: LanguageRunner,
    initMap: Map<string, Promise<void>>
  ): Promise<void> {
    if (!initMap.has(cacheKey)) {
      const initPromise = runner.init().finally(() => {
        initMap.delete(cacheKey);
      });
      initMap.set(cacheKey, initPromise);
    }

    const pendingInitialization = initMap.get(cacheKey);
    if (pendingInitialization) {
      await pendingInitialization;
    }
  }

  /** Check whether preparing a language will trigger initialization */
  needsInitialization(language: string, runtimeMode?: RuntimeMode): boolean {
    const key = this.resolveRunnerKey(language, runtimeMode);
    if (key.kind === 'runtime-mode') {
      const runtimeRunner = this.runtimeModeRunners.get(key.mode);
      if (!runtimeRunner) return false;
      if (this.runtimeModeInitializing.has(key.mode)) return true;
      return !runtimeRunner.isReady();
    }

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
  async prepareRunner(
    language: string,
    runtimeMode?: RuntimeMode
  ): Promise<RunnerPreparationResult> {
    const runner = await this.ensureRunner(language, runtimeMode);
    if (!runner) {
      return { runner: null, initialized: false };
    }

    const initialized = !runner.isReady();
    if (initialized) {
      const key = this.resolveRunnerKey(language, runtimeMode);
      const cacheKey = key.kind === 'runtime-mode' ? key.mode : language;
      const initMap =
        key.kind === 'runtime-mode' ? this.runtimeModeInitializing : this.initializing;
      await this.initializeRunner(cacheKey, runner, initMap);
    }

    return { runner, initialized };
  }

  /** Get the runner for a given language, initializing if needed */
  async getRunner(language: string, runtimeMode?: RuntimeMode): Promise<LanguageRunner | null> {
    const { runner } = await this.prepareRunner(language, runtimeMode);
    return runner;
  }

  /** Execute code in the appropriate language runner */
  async execute(
    language: string,
    code: string,
    context?: ExecutionContext,
    runtimeMode?: RuntimeMode
  ): Promise<ExecutionResult> {
    const runner = await this.getRunner(language, runtimeMode);

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
  stop(language: string, runtimeMode?: RuntimeMode): void {
    const key = this.resolveRunnerKey(language, runtimeMode);
    if (key.kind === 'runtime-mode') {
      const runtimeRunner = this.runtimeModeRunners.get(key.mode);
      runtimeRunner?.stop();
      return;
    }
    const runner = this.runners.get(language);
    if (runner) {
      runner.stop();
    }
  }

  /**
   * RL-019 Slice 3 — accessor for the BrowserPreviewRunner. Lets
   * `executeTabManually` push fold-A sibling sources before
   * calling `execute()`. Returns `null` when the runner is not
   * registered (defensive — Slice 3 always registers it).
   */
  getBrowserPreviewRunner(): BrowserPreviewRunner | null {
    const runner = this.runtimeModeRunners.get('browser-preview');
    return runner instanceof BrowserPreviewRunner ? runner : null;
  }

  /** Stop all runners */
  stopAll(): void {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    // RL-019 Slice 3 — runtime-mode-keyed runners (BrowserPreview
    // today) also need stopping; otherwise an in-flight iframe run
    // would keep streaming console events after a teardown.
    for (const runner of this.runtimeModeRunners.values()) {
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
