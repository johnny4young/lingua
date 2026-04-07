/**
 * RunLang Plugin Interface
 *
 * A plugin adds support for a local language integration.
 * In the current app model, plugin manifests are discovered from the local
 * plugin directory and mapped to runtimes that are already bundled with the
 * application. Arbitrary third-party code loading is intentionally out of
 * scope for now.
 *
 * ## Minimal example
 *
 * ```ts
 * import type { RunLangPlugin } from '@/plugins';
 *
 * export const myPlugin: RunLangPlugin = {
 *   id: 'my-language',
 *   name: 'My Language',
 *   version: '0.1.0',
 *   language: 'my-language',
 *   monacoLanguage: 'plaintext',   // Monaco language ID to use for syntax highlighting
 *   extensions: ['.myl'],
 *
 *   async createRunner() {
 *     const { MyRunner } = await import('./my-runner');
 *     return new MyRunner();
 *   },
 * };
 * ```
 *
 * ## Registering
 *
 * ```ts
 * import { pluginRegistry } from '@/plugins';
 * import { myPlugin } from './my-plugin';
 *
 * pluginRegistry.register(myPlugin);
 * ```
 *
 * The app normally performs this registration through the plugin store after
 * it validates installed manifests, so most plugins should not self-register
 * directly from the app entry point.
 */

import type { ExecutionContext, ExecutionResult } from '../types';

// ---------------------------------------------------------------- Plugin types

/**
 * Plugin runner interface — mirrors LanguageRunner but allows any string as
 * `language` so plugins can introduce languages beyond the built-in union.
 */
export interface PluginRunner {
  id: string;
  name: string;
  language: PluginLanguageId;
  extensions: string[];
  init(): Promise<void>;
  execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
  stop(): void;
  isReady(): boolean;
}

/** The language identifier used in the plugin. May be any string. */
export type PluginLanguageId = string;

/**
 * Metadata + factory for a RunLang language plugin.
 * All fields are required unless marked optional.
 */
export interface RunLangPlugin {
  /** Unique identifier — must be stable across versions (used as a key) */
  id: string;

  /** Human-readable display name shown in the language selector */
  name: string;

  /** Semver version string for the plugin */
  version: string;

  /** Language identifier passed to the runner and used in tab metadata */
  language: PluginLanguageId;

  /**
   * Monaco Editor language id for syntax highlighting.
   * Use one of the built-in ids (e.g. 'lua', 'ruby', 'kotlin') or
   * register a custom grammar via `monaco.languages.register`.
   * Falls back to 'plaintext' if omitted.
   */
  monacoLanguage?: string;

  /** File extensions the plugin handles, e.g. ['.lua', '.luac'] */
  extensions: string[];

  /**
   * Optional default starter code shown in new tabs for this language.
   */
  defaultCode?: string;

  /**
   * Factory that creates a PluginRunner instance for this plugin.
   * Called once per RunnerManager lifetime (result is cached).
   * Use dynamic import() here to keep startup bundle size small.
   */
  createRunner(): Promise<PluginRunner>;
}

// ---------------------------------------------------------------- Registry

/**
 * Plugin registry — singleton that holds all registered plugins.
 * The RunnerManager queries this to extend the set of supported languages.
 */
export class PluginRegistry {
  private plugins: Map<string, RunLangPlugin> = new Map();

  /**
   * Register a plugin. Throws if a plugin with the same `id` is already
   * registered (prevents accidental double-registration).
   */
  register(plugin: RunLangPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(
        `RunLang plugin "${plugin.id}" is already registered. ` +
          'Use a unique id or call unregister() first.'
      );
    }
    this.plugins.set(plugin.id, plugin);
  }

  /** Remove a previously registered plugin */
  unregister(id: string): void {
    this.plugins.delete(id);
  }

  /** Get plugin by id */
  get(id: string): RunLangPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Get plugin by language identifier */
  getByLanguage(language: PluginLanguageId): RunLangPlugin | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.language === language) return plugin;
    }
    return undefined;
  }

  /** All registered plugins */
  getAll(): RunLangPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Check if any plugin handles the given language */
  hasLanguage(language: PluginLanguageId): boolean {
    return this.getByLanguage(language) !== undefined;
  }
}

/** Global plugin registry singleton */
export const pluginRegistry = new PluginRegistry();

// ---------------------------------------------------------------- Base class (optional helper)

/**
 * Optional base class for plugin runners.
 * Provides sensible defaults so concrete runners only need to implement
 * `execute()` and optionally override `init()`.
 */
export abstract class BasePluginRunner implements PluginRunner {
  abstract id: string;
  abstract name: string;
  abstract language: PluginLanguageId;
  abstract extensions: string[];

  protected ready = false;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  abstract execute(
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult>;

  stop(): void {
    // Default: no-op. Override if you spawn workers or processes.
  }
}
