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

import i18next from 'i18next';
import type { ExecutionContext, ExecutionResult, ConsoleOutput } from '../types';
import {
  appendCappedConsole,
  runnerStoppedResult,
  runnerTimeoutResult,
  truncateSerialized,
  type TranslateFn,
} from '../runners/limits';
import { BasePluginRunner } from './index';
import type { LinguaPlugin, PluginRunner } from './index';

interface FengariModule {
  lua: typeof import('fengari').lua;
  lauxlib: typeof import('fengari').lauxlib;
  lualib: typeof import('fengari').lualib;
  to_luastring: (value: string, cache?: boolean) => Uint8Array;
}

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

/**
 * Deadline applied when the caller does not pass `context.timeout`.
 * Matches the JS/TS runners' `normal` preset baseline so Lua does not
 * silently get a longer (or infinite) budget than its siblings.
 */
const DEFAULT_LUA_TIMEOUT_MS = 5_000;

/**
 * Instructions executed between deadline checks. Fengari runs Lua on the
 * renderer main thread, so a parent-side kill timer can never fire while
 * a tight `while true do end` is spinning — the ONLY interruption point
 * is a `LUA_MASKCOUNT` debug hook inside the VM itself. 10k instructions
 * keeps hook overhead negligible while bounding overshoot past the
 * deadline to well under a millisecond of extra work.
 */
const LUA_HOOK_INSTRUCTION_COUNT = 10_000;

/**
 * Sentinel raised from the count hook so the pcall error path can tell
 * a deadline/stop abort apart from a genuine user runtime error.
 */
const LUA_ABORT_SENTINEL = '__lingua_lua_abort__';

/** Marker appended when a serialized value hits the shared result cap. */
const LUA_TRUNCATION_MARKER = '… [truncated]';

function formatConsoleArg(value: unknown): string {
  if (typeof value === 'string') {
    return truncateSerialized(value, LUA_TRUNCATION_MARKER);
  }
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
    return truncateSerialized(JSON.stringify(value), LUA_TRUNCATION_MARKER);
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
  /**
   * Stop-flag observed by the in-VM count hook. Because Fengari executes
   * synchronously on the renderer main thread, a Stop click can only be
   * delivered between event-loop turns — i.e. effectively never while a
   * run is blocking. The deadline below is the operative guard; the flag
   * exists so `stop()` is honest plumbing if execution ever moves to a
   * worker, and so a stop registered between async init and pcall aborts
   * the run before it starts.
   */
  private stopRequested = false;

  async init(): Promise<void> {
    if (!this.fengari) {
      this.fengari = await import('fengari');
    }
    this.ready = true;
  }

  override stop(): void {
    this.stopRequested = true;
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
      case lua.LUA_TSTRING: {
        const value = lua.lua_tojsstring(L, index);
        // Result values share the workers' serialized-size budget so a
        // string.rep bomb cannot balloon the renderer heap.
        return value === null
          ? value
          : truncateSerialized(value, LUA_TRUNCATION_MARKER);
      }
      default:
        lauxlib.luaL_tolstring(L, index);
        try {
          const value = lua.lua_tojsstring(L, -1);
          return value === null
            ? value
            : truncateSerialized(value, LUA_TRUNCATION_MARKER);
        } finally {
          lua.lua_pop(L, 1);
        }
    }
  }

  async execute(
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult> {
    if (!this.fengari) {
      await this.init();
    }
    this.stopRequested = false;

    const { lua, lauxlib, lualib, to_luastring } = this.fengari!;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let droppedStdout = 0;
    const timeoutMs =
      typeof context?.timeout === 'number'
        ? context.timeout
        : DEFAULT_LUA_TIMEOUT_MS;
    const startedAt = performance.now();
    const deadline = startedAt + timeoutMs;
    let abortedByDeadline = false;
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

      // Same per-stream entry cap as every worker runner — an unbounded
      // print loop must not grow the renderer heap until it OOMs.
      droppedStdout = appendCappedConsole(
        stdout,
        { type: 'log', args },
        droppedStdout,
        t
      );

      return 0;
    });
    lua.lua_setglobal(L, to_luastring('print'));

    // Deadline enforcement. Fengari runs synchronously on the renderer
    // main thread, so the parent-side kill timer the worker runners use
    // can never fire here — the VM's own instruction-count hook is the
    // only interruption point. Raising a Lua error from the hook unwinds
    // through lua_pcall exactly like a user error; the sentinel message
    // lets the error path map it to the canonical timeout/stop result.
    lua.lua_sethook(
      L,
      (state) => {
        if (this.stopRequested || performance.now() >= deadline) {
          abortedByDeadline = true;
          lauxlib.luaL_error(state, to_luastring(LUA_ABORT_SENTINEL));
        }
      },
      lua.LUA_MASKCOUNT,
      LUA_HOOK_INSTRUCTION_COUNT
    );

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
        const rawMessage = lua.lua_tojsstring(L, -1) ?? 'Lua runtime error';
        if (abortedByDeadline || rawMessage.includes(LUA_ABORT_SENTINEL)) {
          return this.stopRequested
            ? runnerStoppedResult(t, { stdout, stderr })
            : runnerTimeoutResult(timeoutMs, t, { stdout, stderr });
        }
        return {
          stdout,
          stderr,
          result: undefined,
          executionTime: performance.now() - startedAt,
          error: {
            message: rawMessage,
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

export const luaPlugin: LinguaPlugin = {
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
    'greet("Lingua")',
  ].join('\n'),

  async createRunner(): Promise<PluginRunner> {
    return new LuaRunner();
  },
};
