import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetCommandBusForTesting, emitCommand, subscribeCommand } from '@/stores/commandBus';

describe('renderer command bus', () => {
  afterEach(() => {
    _resetCommandBusForTesting();
  });

  it('delivers every repeated command synchronously without coalescing', () => {
    const listener = vi.fn();
    subscribeCommand('editor.scroll', listener);

    emitCommand('editor.scroll', { scrollTop: 10 });
    emitCommand('editor.scroll', { scrollTop: 10 });
    emitCommand('editor.scroll', { scrollTop: 20 });

    expect(listener.mock.calls.map(([payload]) => payload)).toEqual([
      { scrollTop: 10 },
      { scrollTop: 10 },
      { scrollTop: 20 },
    ]);
  });

  it('does not replay a command emitted before a listener subscribes', () => {
    emitCommand('overlay.openSnippets');
    const listener = vi.fn();
    subscribeCommand('overlay.openSnippets', listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('runs higher priorities first and skips a claimed fallback', () => {
    const order: string[] = [];
    subscribeCommand(
      'file.open',
      (_payload, context) => {
        order.push('claim');
        context.markHandled();
      },
      { priority: 100 }
    );
    subscribeCommand(
      'file.open',
      () => {
        order.push('fallback');
      },
      { priority: -100, delivery: 'fallback' }
    );

    const result = emitCommand('file.open', { file: 'src/demo.ts', line: 4 });

    expect(order).toEqual(['claim']);
    expect(result).toEqual({ handled: true, delivered: 1 });
  });

  it('preserves registration order for equal priorities and unsubscribes exactly once', () => {
    const order: string[] = [];
    const unsubscribeFirst = subscribeCommand('share.succeeded', () => order.push('first'));
    subscribeCommand('share.succeeded', () => order.push('second'));

    emitCommand('share.succeeded');
    unsubscribeFirst();
    unsubscribeFirst();
    emitCommand('share.succeeded');

    expect(order).toEqual(['first', 'second', 'second']);
  });
});
