import { describe, expect, it, vi } from 'vitest';
import {
  evaluateDebuggerExpression,
  renderDebuggerLogpoint,
  snapshotDebuggerScope,
} from '../../src/renderer/workers/debuggerExpression';

describe('bounded debugger expressions', () => {
  it('evaluates data-oriented expressions over a detached locals snapshot', () => {
    const scope = snapshotDebuggerScope({
      count: 4,
      user: { profile: { name: 'Ada' } },
      flags: [true, false],
    });

    expect(evaluateDebuggerExpression('count > 3 && flags[0]', scope)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluateDebuggerExpression('user.profile.name', scope)).toEqual({
      ok: true,
      value: 'Ada',
    });
    expect(evaluateDebuggerExpression('`hello ${user.profile.name}`', scope)).toEqual({
      ok: true,
      value: 'hello Ada',
    });
  });

  it('rejects executable and mutating syntax instead of using eval', () => {
    const scope = snapshotDebuggerScope({ count: 4, fn: () => 8 });

    for (const expression of [
      'fn()',
      'new Date()',
      'count = 5',
      'count++',
      'globalThis.fetch("https://example.com")',
    ]) {
      expect(evaluateDebuggerExpression(expression, scope)).toEqual(
        expect.objectContaining({ ok: false })
      );
    }
    expect(evaluateDebuggerExpression('count', scope)).toEqual({ ok: true, value: 4 });
  });

  it('preserves primitive comparison semantics and rejects ambiguous loose equality', () => {
    const scope = snapshotDebuggerScope({ numericText: '10', lower: 'alpha', upper: 'beta' });

    expect(evaluateDebuggerExpression('lower < upper', scope)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluateDebuggerExpression('numericText === 10', scope)).toEqual({
      ok: true,
      value: false,
    });
    expect(evaluateDebuggerExpression('numericText == 10', scope)).toEqual({
      ok: false,
      error: 'Use strict equality (=== or !==)',
    });
  });

  it('blocks prototype traversal and inherited properties', () => {
    const scope = snapshotDebuggerScope({ value: { safe: 1 } });

    expect(evaluateDebuggerExpression('value.safe', scope)).toEqual({ ok: true, value: 1 });
    expect(evaluateDebuggerExpression('value.constructor', scope)).toEqual(
      expect.objectContaining({ ok: false, error: 'Prototype access is not allowed' })
    );
    expect(evaluateDebuggerExpression('value.toString', scope)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('copies data descriptors without invoking getters or preserving cycles', () => {
    const getter = vi.fn(() => 'secret');
    const value: Record<string, unknown> = { safe: 1 };
    Object.defineProperty(value, 'computed', { enumerable: true, get: getter });
    value.self = value;

    const scope = snapshotDebuggerScope({ value });

    expect(getter).not.toHaveBeenCalled();
    expect(evaluateDebuggerExpression('value.safe', scope)).toEqual({ ok: true, value: 1 });
    expect(evaluateDebuggerExpression('value.computed', scope)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(evaluateDebuggerExpression('value.self', scope)).toEqual({
      ok: true,
      value: '[Circular]',
    });
  });

  it('renders logpoint templates with escaped braces and bounded placeholders', () => {
    const scope = snapshotDebuggerScope({ count: 4, user: { name: 'Ada' } });

    expect(renderDebuggerLogpoint('count={count}, user={user.name}', scope)).toEqual({
      ok: true,
      output: 'count=4, user=Ada',
    });
    expect(renderDebuggerLogpoint('{{literal}} {count * 2}', scope)).toEqual({
      ok: true,
      output: '{literal} 8',
    });
    expect(renderDebuggerLogpoint('unsafe={globalThis.fetch("x")}', scope)).toEqual(
      expect.objectContaining({ ok: false })
    );
  });
});
