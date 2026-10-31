/**
 * Direct coverage for the store-free decisions of a manual run. They use only
 * built-in languages, so no registered plugin can change a mode. The
 * integration guards in `tests/runtime/executeTabManually.*.test.ts` cover how
 * those decisions reach the stores, the runner and telemetry.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveRunExecution,
  resolveRunPlan,
  type RunPlan,
} from '../../../src/renderer/runtime/execute/resolveRunPlan';
import { resolveTimeoutMs } from '../../../src/shared/runtimeTimeoutPresets';
import type { FileTab } from '../../../src/renderer/types/editor';

function tab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    name: 'main.js',
    language: 'javascript',
    content: 'console.log(1)',
    isDirty: false,
    ...overrides,
  };
}

const settings = {
  showLineTiming: false,
  variableInspectorScopeDepth: 2,
  runtimeTimeoutPresetByLanguage: { javascript: 'quick', python: 'long', go: 'normal' } as const,
};

const runPlan = (overrides: Partial<RunPlan> = {}): RunPlan => ({
  mode: 'run',
  debugRequested: false,
  recordRequested: false,
  usesNativeDebugger: false,
  recordHistory: true,
  region: null,
  ...overrides,
});

describe('resolveRunPlan', () => {
  it('maps each language to its execution mode', () => {
    expect(resolveRunPlan(tab(), {}).mode).toBe('run');
    expect(resolveRunPlan(tab({ language: 'json' }), {}).mode).toBe('validate');
    expect(resolveRunPlan(tab({ language: 'markdown' }), {}).mode).toBe('view');
  });

  it('records history unless the caller opts out', () => {
    expect(resolveRunPlan(tab(), {}).recordHistory).toBe(true);
    expect(resolveRunPlan(tab(), { recordHistory: true }).recordHistory).toBe(true);
    expect(resolveRunPlan(tab(), { recordHistory: false }).recordHistory).toBe(false);
  });

  it('routes Debug through the native debugger only for Python, Go and Rust', () => {
    for (const language of ['python', 'go', 'rust']) {
      expect(resolveRunPlan(tab({ language }), { debug: true })).toMatchObject({
        debugRequested: true,
        usesNativeDebugger: true,
      });
    }
    expect(resolveRunPlan(tab(), { debug: true })).toMatchObject({
      debugRequested: true,
      usesNativeDebugger: false,
    });
    expect(resolveRunPlan(tab({ language: 'python' }), {})).toMatchObject({
      debugRequested: false,
      usesNativeDebugger: false,
    });
  });
});

describe('resolveRunExecution — timeout precedence', () => {
  const magic = '// @timeout 7s\nwhile (true) {}';

  it('prefers the lifecycle override over everything else', () => {
    const execution = resolveRunExecution(
      tab({ content: magic, nextRunTimeoutOverrideMs: 9_000 }),
      runPlan(),
      { executionTimeoutMs: 3_000 },
      settings
    );
    expect(execution.context.timeout).toBe(3_000);
    expect(execution.deadlineTimeoutMs).toBe(3_000);
    // The one-shot override is still consumed even when it did not win.
    expect(execution.clearsTimeoutOverride).toBe(true);
  });

  it('prefers the one-shot tab override over the magic comment', () => {
    const execution = resolveRunExecution(
      tab({ content: magic, nextRunTimeoutOverrideMs: 9_000 }),
      runPlan(),
      {},
      settings
    );
    expect(execution.context.timeout).toBe(9_000);
    expect(execution.deadlineTimeoutMs).toBe(9_000);
    expect(execution.clearsTimeoutOverride).toBe(true);
  });

  it('uses the magic comment when no override is set', () => {
    const execution = resolveRunExecution(tab({ content: magic }), runPlan(), {}, settings);
    expect(execution.context.timeout).toBe(7_000);
    expect(execution.deadlineTimeoutMs).toBe(7_000);
    expect(execution.clearsTimeoutOverride).toBe(false);
  });

  it('leaves the runner timeout to the Settings preset and shows it on the deadline', () => {
    const execution = resolveRunExecution(tab(), runPlan(), {}, settings);
    expect(execution.context).not.toHaveProperty('timeout');
    expect(execution.deadlineTimeoutMs).toBe(resolveTimeoutMs('javascript', 'quick'));
    expect(execution.clearsTimeoutOverride).toBe(false);
  });

  it('shows no deadline for a native debugger session or a language without presets', () => {
    expect(
      resolveRunExecution(
        tab({ language: 'python', name: 'main.py' }),
        runPlan({ debugRequested: true, usesNativeDebugger: true }),
        {},
        settings
      ).deadlineTimeoutMs
    ).toBeUndefined();
    expect(
      resolveRunExecution(tab({ language: 'rust', name: 'main.rs' }), runPlan(), {}, settings)
        .deadlineTimeoutMs
    ).toBeUndefined();
  });

  it('ignores a magic comment in a language without the directive', () => {
    const execution = resolveRunExecution(
      tab({ language: 'go', name: 'main.go', content: '// @timeout 7s' }),
      runPlan(),
      {},
      settings
    );
    expect(execution.context).not.toHaveProperty('timeout');
    expect(execution.deadlineTimeoutMs).toBe(resolveTimeoutMs('go', 'normal'));
  });
});

describe('resolveRunExecution — context', () => {
  it('always names the tab and carries only the inputs that are set', () => {
    expect(resolveRunExecution(tab(), runPlan(), {}, settings).context).toEqual({
      language: 'javascript',
      tabId: 'tab-1',
      captureScope: true,
      scopeDepth: 2,
    });

    expect(
      resolveRunExecution(
        tab({
          filePath: '/project/main.js',
          stdinBuffer: 'Ada',
          inputArgs: ['--mode', 'fast'],
        }),
        runPlan(),
        {},
        { ...settings, showLineTiming: true }
      ).context
    ).toEqual({
      language: 'javascript',
      filePath: '/project/main.js',
      tabId: 'tab-1',
      stdin: 'Ada',
      args: ['--mode', 'fast'],
      lineTiming: true,
      captureScope: true,
      scopeDepth: 2,
    });
  });

  it('drops empty stdin and empty argument lists', () => {
    const { context } = resolveRunExecution(
      tab({ stdinBuffer: '', inputArgs: [] }),
      runPlan(),
      {},
      settings
    );
    expect(context).not.toHaveProperty('stdin');
    expect(context).not.toHaveProperty('args');
  });

  it('captures scope only for inspector languages and never while debugging', () => {
    expect(
      resolveRunExecution(tab({ language: 'python' }), runPlan(), {}, settings).context
    ).toMatchObject({ captureScope: true, scopeDepth: 2 });

    const debugging = resolveRunExecution(
      tab(),
      runPlan({ debugRequested: true }),
      {},
      settings
    ).context;
    expect(debugging).toMatchObject({ debug: true });
    expect(debugging).not.toHaveProperty('captureScope');
    expect(debugging).not.toHaveProperty('scopeDepth');

    const go = resolveRunExecution(tab({ language: 'go' }), runPlan(), {}, settings).context;
    expect(go).not.toHaveProperty('captureScope');
  });

  it('omits a malformed persisted scope depth but keeps the capture', () => {
    const { context } = resolveRunExecution(tab(), runPlan(), {}, {
      ...settings,
      variableInspectorScopeDepth: 'deep' as unknown as number,
    });
    expect(context).toMatchObject({ captureScope: true });
    expect(context).not.toHaveProperty('scopeDepth');
  });

  it('runs a region only for JS, TS and Python, without Debug or Record, history off and auto-log on', () => {
    const region = { index: 1, name: 'a', markerLine: 2, startLine: 2, endLine: 3 };
    expect(resolveRunPlan(tab(), { region })).toMatchObject({ region, recordHistory: false });
    expect(resolveRunPlan(tab({ language: 'python' }), { region }).region).toEqual(region);
    expect(resolveRunPlan(tab({ language: 'go' }), { region })).toMatchObject({ region: null, recordHistory: true });
    expect(resolveRunPlan(tab(), { region, debug: true }).region).toBeNull();
    expect(resolveRunPlan(tab(), { region, record: true }).region).toBeNull();
    expect(resolveRunExecution(tab(), runPlan({ region }), {}, settings).context).toMatchObject({ autoLog: true, askStdin: true });
    expect(resolveRunExecution(tab(), runPlan(), {}, settings).context).not.toHaveProperty('autoLog');
    expect(resolveRunExecution(tab(), runPlan(), {}, settings).context).not.toHaveProperty('askStdin');
    const masked = [{ index: 1, value: 'secret' }];
    expect(resolveRunExecution(tab({ stdinBuffer: 'a\nb' }), runPlan({ region }), { maskedStdin: masked }, settings).context.stdin).toBe('a\nsecret\nb');
    expect(resolveRunExecution(tab({ stdinBuffer: 'a\nb' }), runPlan(), { maskedStdin: masked }, settings).context.stdin).toBe('a\nb');
  });

  it('records only JS and TS Worker tabs, never alongside Debug, and drops scope capture', () => {
    expect(resolveRunPlan(tab(), { record: true }).recordRequested).toBe(true);
    expect(resolveRunPlan(tab({ language: 'typescript' }), { record: true }).recordRequested).toBe(true);
    expect(resolveRunPlan(tab({ runtimeMode: 'node' }), { record: true }).recordRequested).toBe(false);
    expect(resolveRunPlan(tab({ language: 'python' }), { record: true }).recordRequested).toBe(false);
    expect(resolveRunPlan(tab(), { record: true, debug: true })).toMatchObject({ recordRequested: false, debugRequested: true });
    const context = resolveRunExecution(tab(), runPlan({ recordRequested: true }), {}, settings).context;
    expect(context).toMatchObject({ record: true });
    expect(context).not.toHaveProperty('captureScope');
  });
});
