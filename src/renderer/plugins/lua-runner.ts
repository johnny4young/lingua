/**
 * Example Plugin: Lua Runner
 *
 * This is a stub/template that shows how to add a new language to RunLang.
 * It is NOT wired into the RunnerManager by default — it exists purely as
 * documentation and a starting point for plugin authors.
 *
 * ## How to activate this plugin
 *
 * 1. Import and register it early in your app entry point:
 *
 *    ```ts
 *    // src/renderer/main.tsx  (or src/web/main.tsx)
 *    import { pluginRegistry } from '@/plugins';
 *    import { luaPlugin } from '@/plugins/lua-runner';
 *    pluginRegistry.register(luaPlugin);
 *    ```
 *
 * 2. Extend `RunnerManager.constructor()` to query the plugin registry
 *    and add runners for any registered plugins.
 *
 * ## Real Lua execution approaches
 *
 * | Approach | Bundle impact | Notes |
 * |---|---|---|
 * | fengari-web (pure JS Lua 5.3) | ~150 kB | works in browser + Electron |
 * | wasmoon (Lua 5.4 WASM) | ~400 kB | best compatibility |
 * | native Lua via IPC (Electron only) | 0 kB renderer | requires Lua installed |
 *
 * This stub uses `fengari-web` as the example. Install it before uncommenting:
 *   npm install fengari-web
 */

import type { ExecutionContext, ExecutionResult, ConsoleOutput } from '../types';
import { BasePluginRunner } from './index';
import type { RunLangPlugin, PluginRunner } from './index';

// ---------------------------------------------------------------- Runner

export class LuaRunner extends BasePluginRunner {
  id = 'lua';
  name = 'Lua';
  language = 'lua';
  extensions = ['.lua'];

  async init(): Promise<void> {
    // Lazy-load fengari-web when first needed (keeps initial bundle lean).
    // Uncomment and install fengari-web to make this functional:
    //
    // const { lauxlib, lua, lualib, to_luastring } = await import('fengari-web');
    // this._fengari = { lauxlib, lua, lualib, to_luastring };

    this.ready = true;
  }

  async execute(
    code: string,
    _context?: ExecutionContext
  ): Promise<ExecutionResult> {
    const stdout: ConsoleOutput[] = [];

    // ---- Stub output -------------------------------------------------------
    // Replace this block with real fengari-web execution once it's installed.
    stdout.push({
      type: 'warn',
      args: [
        'Lua runner is a stub. ' +
          'Install fengari-web and implement LuaRunner.execute() to run Lua code.',
      ],
    });
    stdout.push({
      type: 'log',
      args: [`-- Received ${code.length} bytes of Lua source (not executed)`],
    });
    // ------------------------------------------------------------------------

    return {
      stdout,
      stderr: [],
      result: undefined,
      executionTime: 0,
    };
  }
}

// ---------------------------------------------------------------- Plugin descriptor

export const luaPlugin: RunLangPlugin = {
  id: 'lua',
  name: 'Lua',
  version: '0.1.0',
  language: 'lua',
  monacoLanguage: 'lua', // Monaco has built-in Lua syntax highlighting
  extensions: ['.lua'],
  defaultCode: [
    '-- Lua example',
    'local function greet(name)',
    '  print("Hello, " .. name .. "!")',
    'end',
    '',
    'greet("RunLang")',
  ].join('\n'),

  async createRunner(): Promise<PluginRunner> {
    return new LuaRunner();
  },
};
