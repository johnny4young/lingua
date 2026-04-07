/**
 * Bundled Lua plugin runtime
 *
 * This runtime is bundled with the app, but it is only activated when the
 * local plugin manifest loader discovers a matching `pluginId` entry.
 * It uses Fengari, a Lua 5.3 implementation in JavaScript, so the plugin can
 * execute in both desktop and browser-capable builds without native toolchains.
 *
 * ## Real Lua execution approaches
 *
 * | Approach | Bundle impact | Notes |
 * |---|---|---|
 * | Fengari (pure JS Lua 5.3) | bundled | works in browser + Electron |
 * | wasmoon (Lua 5.4 WASM) | ~400 kB | best compatibility |
 * | native Lua via IPC (Electron only) | 0 kB renderer | requires Lua installed |
 */

import type { ExecutionContext, ExecutionResult, ConsoleOutput } from '../types';
import { BasePluginRunner } from './index';
import type { RunLangPlugin, PluginRunner } from './index';

interface FengariModule {
  lua: typeof import('fengari').lua;
  lauxlib: typeof import('fengari').lauxlib;
  lualib: typeof import('fengari').lualib;
  to_luastring: (value: string, cache?: boolean) => Uint8Array;
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------- Runner

export class LuaRunner extends BasePluginRunner {
  id = 'lua';
  name = 'Lua';
  language = 'lua';
  extensions = ['.lua'];
  private fengari: FengariModule | null = null;

  async init(): Promise<void> {
    if (!this.fengari) {
      this.fengari = await import('fengari');
    }
    this.ready = true;
  }

  private readValue(
    lua: typeof import('fengari').lua,
    lauxlib: typeof import('fengari').lauxlib,
    L: import('fengari').FengariLuaState,
    index: number
  ): unknown {
    const valueType = lua.lua_type(L, index);

    switch (valueType) {
      case lua.LUA_TNIL:
        return null;
      case lua.LUA_TBOOLEAN:
        return Boolean(lua.lua_toboolean(L, index));
      case lua.LUA_TNUMBER:
        return lua.lua_isinteger(L, index)
          ? lua.lua_tointeger(L, index)
          : lua.lua_tonumber(L, index);
      case lua.LUA_TSTRING:
        return lua.lua_tojsstring(L, index);
      default:
        lauxlib.luaL_tolstring(L, index);
        try {
          return lua.lua_tojsstring(L, -1);
        } finally {
          lua.lua_pop(L, 1);
        }
    }
  }

  async execute(
    code: string,
    _context?: ExecutionContext
  ): Promise<ExecutionResult> {
    if (!this.fengari) {
      await this.init();
    }

    const { lua, lauxlib, lualib, to_luastring } = this.fengari!;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const startedAt = performance.now();
    const L = lauxlib.luaL_newstate();

    if (!L) {
      return {
        stdout,
        stderr,
        result: undefined,
        executionTime: 0,
        error: {
          message: 'Failed to create Lua runtime.',
        },
      };
    }

    lualib.luaL_openlibs(L);
    lua.lua_pushjsfunction(L, (state) => {
      const top = lua.lua_gettop(state);
      const args: string[] = [];

      for (let index = 1; index <= top; index += 1) {
        args.push(formatConsoleArg(this.readValue(lua, lauxlib, state, index)));
      }

      stdout.push({
        type: 'log',
        args,
      });

      return 0;
    });
    lua.lua_setglobal(L, to_luastring('print'));

    try {
      const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(code));
      if (loadStatus !== lua.LUA_OK) {
        return {
          stdout,
          stderr,
          result: undefined,
          executionTime: performance.now() - startedAt,
          error: {
            message: lua.lua_tojsstring(L, -1) ?? 'Lua syntax error',
          },
        };
      }

      const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
      if (callStatus !== lua.LUA_OK) {
        return {
          stdout,
          stderr,
          result: undefined,
          executionTime: performance.now() - startedAt,
          error: {
            message: lua.lua_tojsstring(L, -1) ?? 'Lua runtime error',
          },
        };
      }

      const top = lua.lua_gettop(L);
      const values: unknown[] = [];

      for (let index = 1; index <= top; index += 1) {
        values.push(this.readValue(lua, lauxlib, L, index));
      }

      return {
        stdout,
        stderr,
        result:
          values.length === 0
            ? undefined
          : values.length === 1
              ? values[0]
              : values,
        executionTime: performance.now() - startedAt,
      };
    } finally {
      lua.lua_close(L);
    }
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
