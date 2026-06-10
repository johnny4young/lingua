/**
 * LuaRunner resource limits — the audit gap this locks: Lua was the only
 * runner with NO deadline, NO output caps, and a no-op stop. Fengari runs
 * synchronously on the renderer main thread, so the deadline is enforced
 * from INSIDE the VM via a LUA_MASKCOUNT instruction hook (a parent-side
 * kill timer can never fire while the thread is blocked).
 *
 * These tests run the REAL fengari VM — no mocks — so the hook mechanics
 * (luaL_error unwinding through lua_pcall) are exercised end to end.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0
        ? `${key}:${JSON.stringify(options)}`
        : key,
  },
}));

import { LuaRunner } from '../../src/renderer/plugins/lua-runner';
import { MAX_CONSOLE_ENTRIES, MAX_RESULT_BYTES } from '../../src/renderer/runners/limits';

describe('LuaRunner limits', () => {
  let runner: LuaRunner;

  beforeEach(async () => {
    runner = new LuaRunner();
    await runner.init();
  });

  it('still executes normal programs and returns values', async () => {
    const result = await runner.execute('print("hi"); return 1 + 1');
    expect(result.error).toBeUndefined();
    expect(result.result).toBe(2);
    expect(result.stdout[0]).toEqual({ type: 'log', args: ['hi'] });
  });

  it('aborts an infinite loop at the deadline instead of freezing forever', async () => {
    const started = Date.now();
    const result = await runner.execute('while true do end', {
      timeout: 150,
    });
    const elapsed = Date.now() - started;

    expect(result.kind).toBe('timeout');
    expect(result.error?.message).toContain('runner.timeout.message');
    // The instruction hook fires every 10k instructions, so the overshoot
    // past the 150ms deadline must be small — generous bound for CI.
    expect(elapsed).toBeLessThan(5_000);
  });

  it('caps unbounded print output at the shared console-entry limit', async () => {
    const result = await runner.execute(
      `for i = 1, ${MAX_CONSOLE_ENTRIES + 500} do print(i) end`
    );
    expect(result.error).toBeUndefined();
    expect(result.stdout.length).toBe(MAX_CONSOLE_ENTRIES);
    // The last kept entry is the localized truncation notice.
    expect(result.stdout[MAX_CONSOLE_ENTRIES - 1]).toEqual({
      type: 'warn',
      args: ['runner.truncated.console'],
    });
  });

  it('truncates oversized printed strings and result values', async () => {
    const result = await runner.execute(
      `local s = string.rep("x", ${MAX_RESULT_BYTES + 5_000}); print(s); return s`
    );
    expect(result.error).toBeUndefined();
    const printed = result.stdout[0]!.args[0]!;
    expect(printed.length).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    expect(printed.endsWith('… [truncated]')).toBe(true);
    const returned = result.result as string;
    expect(returned.length).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });

  it('does not let a stale stop request leak into the next run', async () => {
    // execute() resets the stop flag at entry: a Stop click from a
    // PREVIOUS run must not abort the new one. The run still ends via
    // its own deadline (timeout), never as 'stopped'.
    runner.stop();
    const result = await runner.execute('while true do end', { timeout: 150 });
    expect(result.kind).toBe('timeout');
  });
});
