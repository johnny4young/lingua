import { afterEach, expect, it, vi } from 'vitest';
import { runWhenIdle } from '../../src/renderer/utils/runWhenIdle';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses the idle deadline and returns cancellation', () => {
  const idle = vi.fn().mockReturnValue(42);
  const cancel = vi.fn();
  vi.stubGlobal('requestIdleCallback', idle);
  vi.stubGlobal('cancelIdleCallback', cancel);
  const callback = vi.fn();
  const cleanup = runWhenIdle(callback);
  expect(idle).toHaveBeenCalledWith(callback, { timeout: 2000 });
  expect(idle.mock.contexts[0]).toBe(globalThis);
  cleanup();
  expect(cancel).toHaveBeenCalledWith(42);
});

it('runs the fallback once and cancels work for unmounted owners', () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  const callback = vi.fn();
  runWhenIdle(callback)();
  vi.runAllTimers();
  expect(callback).not.toHaveBeenCalled();
  runWhenIdle(callback);
  vi.runAllTimers();
  expect(callback).toHaveBeenCalledTimes(1);
});
