import type { LanguageRunner, ExecutionContext, ExecutionResult } from '../types/execution';
import { JavaScriptRunner } from './javascript';
import { TypeScriptRunner } from './typescript';
import { GoRunner } from './go';
import { PythonRunner } from './python';
import { RubyRunner } from './ruby';
import { RustRunner } from './rust';
import { BrowserPreviewRunner } from './browserPreview';
import { NodeRunner } from './nodeRunner';
import { AltJsRunner } from './altJsRunner';
import { pluginRegistry } from '../plugins';
import { LANGUAGE_PACKS } from '../../shared/languagePacks';
import type { RuntimeMode } from '../../shared/runtimeModes';
import { languageHasRuntimeModes } from '../../shared/runtimeModes';

export interface RunnerPreparationResult {
  runner: LanguageRunner | null;
  initialized: boolean;
  /**
   * Set when the requested runtime mode cannot run on this host. `runner` is
   * then a stand-in whose `execute()` reports why, so every caller surfaces
   * the same error through its normal result path.
   */
  unavailable?: 'desktop-only';
}

/**
 * Built-in runner factories keyed by `LanguagePack.runnerId` .
 *
 * `BUILT_IN_LANGUAGE_RUNNERS` walks `LANGUAGE_PACKS` and keeps every pack
 * whose `runnerId` is present in this map. Packs whose `runnerId` is absent
 * from the map (today: `lua`) intentionally fall through to the plugin
 * registry — implementation is additive, not a pluginRegistry replacement.
 */
const BUILT_IN_RUNNER_FACTORIES: Record<string, () => LanguageRunner> = {
  javascript: () => new JavaScriptRunner(),
  typescript: () => new TypeScriptRunner(),
  go: () => new GoRunner(),
  python: () => new PythonRunner(),
  // implementation — Ruby web runtime via `@ruby/wasm-wasi`. The
  // pack's `runnerId` flipped from `null` to `'ruby'` in the same
  // slice; the factory must land alongside or the registry walk
  // skips the entry and Ruby tabs fall through to the
  // `'No runner available'` message.
  ruby: () => new RubyRunner(),
  rust: () => new RustRunner(),
};

/** Language-pack id to built-in runner factory, in `LANGUAGE_PACKS` order. */
const BUILT_IN_LANGUAGE_RUNNERS: ReadonlyMap<string, () => LanguageRunner> = new Map(
  LANGUAGE_PACKS.flatMap(pack => {
    const factory = pack.runnerId === null ? undefined : BUILT_IN_RUNNER_FACTORIES[pack.runnerId];
    return factory ? [[pack.id, factory] as const] : [];
  })
);

type DesktopBridge = 'node' | 'deno' | 'bun';

interface RuntimeModeRunnerEntry {
  create: () => LanguageRunner;
  /**
   * Set for modes that spawn a local binary through the desktop shell: the
   * `window.lingua` bridge the runner calls, and the error a run reports on a
   * host without it (the web build, or a desktop preload that never exposed
   * the bridge).
   */
  desktopOnly?: { bridge: DesktopBridge; message: string };
}

/**
 * Runtime-mode runners that override the default language-keyed dispatch
 * when the active tab carries an explicit `runtimeMode`. The keys mirror the
 * implemented RuntimeMode values; `'worker'` intentionally has no entry so
 * the default language-keyed path stays the source of truth for the JS
 * Worker, TS Worker, Python Pyodide worker, etc.
 */
const RUNTIME_MODE_RUNNERS: Partial<Record<RuntimeMode, RuntimeModeRunnerEntry>> = {
  'browser-preview': { create: () => new BrowserPreviewRunner() },
  // Desktop Node child-spawn runner.
  node: {
    create: () => new NodeRunner(),
    desktopOnly: {
      bridge: 'node',
      message: 'Node runtime mode is only available in the desktop build.',
    },
  },
  // Deno and Bun desktop runtimes.
  deno: {
    create: () => new AltJsRunner('deno'),
    desktopOnly: {
      bridge: 'deno',
      message: 'Deno (desktop) runtime mode is only available in the desktop build.',
    },
  },
  bun: {
    create: () => new AltJsRunner('bun'),
    desktopOnly: {
      bridge: 'bun',
      message: 'Bun (desktop) runtime mode is only available in the desktop build.',
    },
  },
};

function hasDesktopBridge(bridge: DesktopBridge): boolean {
  if (typeof window === 'undefined' || !window.lingua) return false;
  return Boolean(window.lingua[bridge]);
}

/**
 * Stands in for a desktop-only runtime-mode runner on a host without its
 * bridge. It needs no initialization and never reaches the bridge; a run
 * resolves with the desktop-only error.
 */
class DesktopOnlyRunner implements LanguageRunner {
  readonly id: string;
  readonly name: string;
  readonly language = 'javascript' as const;
  readonly extensions: string[] = [];
  private readonly message: string;

  constructor(mode: RuntimeMode, message: string) {
    this.id = mode;
    this.name = mode;
    this.message = message;
  }

  async init(): Promise<void> {
    // Nothing to boot: the run only reports that the mode is unavailable.
  }

  isReady(): boolean {
    return true;
  }

  async execute(): Promise<ExecutionResult> {
    return {
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 0,
      error: { message: this.message },
      kind: 'error',
    };
  }

  stop(): void {
    // No run is ever in flight.
  }
}

interface ResolvedRunner {
  runner: LanguageRunner;
  unavailable?: RunnerPreparationResult['unavailable'];
}

/**
 * RunnerManager orchestrates language runners.
 * Selects the appropriate runner based on language, manages lifecycle,
 * and provides a unified execution API.
 *
 * Runners are constructed from the registries above the first time a run
 * resolves them, then cached, so a session only builds the runtimes it uses.
 */
export class RunnerManager {
  /** Constructed language runners: built-ins once resolved, plus plugin runners. */
  private runners: Map<string, LanguageRunner> = new Map();
  private initializing: Map<string, Promise<void>> = new Map();
  /** Constructed runtime-mode runners, keyed by mode once resolved. */
  private runtimeModeRunners: Map<RuntimeMode, LanguageRunner> = new Map();
  private runtimeModeInitializing: Map<string, Promise<void>> = new Map();

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
      RUNTIME_MODE_RUNNERS[runtimeMode] !== undefined
    ) {
      return { kind: 'runtime-mode', mode: runtimeMode };
    }
    return { kind: 'language', language };
  }

  /**
   * The runtime-mode runner, constructed on first use. A desktop-only mode on
   * a host without its bridge resolves to a stand-in instead, and the real
   * runner is never constructed.
   */
  private resolveRuntimeModeRunner(mode: RuntimeMode): ResolvedRunner | null {
    const entry = RUNTIME_MODE_RUNNERS[mode];
    if (!entry) return null;
    if (entry.desktopOnly && !hasDesktopBridge(entry.desktopOnly.bridge)) {
      return {
        runner: new DesktopOnlyRunner(mode, entry.desktopOnly.message),
        unavailable: 'desktop-only',
      };
    }
    let runner = this.runtimeModeRunners.get(mode);
    if (!runner) {
      runner = entry.create();
      this.runtimeModeRunners.set(mode, runner);
    }
    return { runner };
  }

  /** A constructed language runner, or the built-in one constructed on first use. */
  private resolveLanguageRunner(language: string): LanguageRunner | null {
    const existing = this.runners.get(language);
    if (existing) return existing;
    const factory = BUILT_IN_LANGUAGE_RUNNERS.get(language);
    if (!factory) return null;
    const runner = factory();
    this.runners.set(language, runner);
    return runner;
  }

  private async ensureRunner(
    language: string,
    runtimeMode?: RuntimeMode
  ): Promise<ResolvedRunner | null> {
    const key = this.resolveRunnerKey(language, runtimeMode);
    if (key.kind === 'runtime-mode') {
      return this.resolveRuntimeModeRunner(key.mode);
    }
    const builtIn = this.resolveLanguageRunner(language);
    if (builtIn) {
      return { runner: builtIn };
    }
    const plugin = pluginRegistry.getByLanguage(language);

    if (plugin) {
      const pluginRunner = await plugin.createRunner();
      this.runners.set(language, pluginRunner as unknown as LanguageRunner);
    }

    const runner = this.runners.get(language);
    return runner ? { runner } : null;
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
      const resolved = this.resolveRuntimeModeRunner(key.mode);
      if (!resolved || resolved.unavailable) return false;
      if (this.runtimeModeInitializing.has(key.mode)) return true;
      return !resolved.runner.isReady();
    }

    if (this.initializing.has(language)) {
      return true;
    }

    const runner = this.resolveLanguageRunner(language);
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
    const resolved = await this.ensureRunner(language, runtimeMode);
    if (!resolved) {
      return { runner: null, initialized: false };
    }

    const { runner, unavailable } = resolved;
    if (unavailable) {
      return { runner, initialized: false, unavailable };
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

  /** Stop execution for a given language. Only a constructed runner can be running. */
  stop(language: string, runtimeMode?: RuntimeMode): void {
    const key = this.resolveRunnerKey(language, runtimeMode);
    const runner =
      key.kind === 'runtime-mode'
        ? this.runtimeModeRunners.get(key.mode)
        : this.runners.get(language);
    runner?.stop();
  }

  /**
   * implementation — accessor for the PythonRunner so
   * `pythonWebInstaller` can reach the same Pyodide worker the
   * runner already manages. Returns `null` if Python isn't a
   * registered language pack (defensive — `LANGUAGE_PACKS` always
   * carries `python`, but the registry walk could skip it in a
   * pared-down build).
   */
  getPythonRunner(): PythonRunner | null {
    const runner = this.resolveLanguageRunner('python');
    return runner instanceof PythonRunner ? runner : null;
  }

  /** Stop every constructed runner */
  stopAll(): void {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    // implementation — runtime-mode-keyed runners (BrowserPreview
    // today) also need stopping; otherwise an in-flight iframe run
    // would keep streaming console events after a teardown.
    for (const runner of this.runtimeModeRunners.values()) {
      runner.stop();
    }
  }

  /** Check if a language is supported */
  isSupported(language: string): boolean {
    return (
      BUILT_IN_LANGUAGE_RUNNERS.has(language) ||
      this.runners.has(language) ||
      pluginRegistry.hasLanguage(language)
    );
  }

  /** Get list of supported languages */
  getSupportedLanguages(): string[] {
    return Array.from(new Set([
      ...BUILT_IN_LANGUAGE_RUNNERS.keys(),
      ...this.runners.keys(),
      ...pluginRegistry.getAll().map((plugin) => plugin.language),
    ]));
  }
}

/** Singleton instance */
export const runnerManager = new RunnerManager();
