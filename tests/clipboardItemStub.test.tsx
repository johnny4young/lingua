/**
 * `tests/setup.ts` installs a `ClipboardItem` stub because jsdom has none and
 * Monaco's WebKit clipboard workaround builds one on every click. That
 * workaround hands each item a pending promise and cancels it on the next
 * click. A real `ClipboardItem` observes the promises it is given; a stub that
 * does not turns every cancellation into an unhandled rejection, which fails
 * the vitest run even when every test passes.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClipboardService } from 'monaco-editor/esm/vs/platform/clipboard/browser/clipboardService.js';

let unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

/** Node reports an unhandled rejection only after the current tick settles. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 20));
}

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', recordUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
});

describe('ClipboardItem test stub', () => {
  it('observes a promise that is rejected after the item is built', async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<string>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });

    new ClipboardItem({ 'text/plain': pending });
    reject(new Error('write cancelled'));
    await settle();

    expect(unhandled).toEqual([]);
  });

  it('still surfaces the rejection to a reader of that type', async () => {
    const failure = new Error('write cancelled');
    const item = new ClipboardItem({ 'text/plain': Promise.reject(failure) });

    await expect(item.getType('text/plain')).rejects.toBe(failure);
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('keeps resolved promises, strings and blobs readable', async () => {
    const item = new ClipboardItem({
      'text/plain': Promise.resolve('from a promise'),
      'text/html': '<b>inline</b>',
      'image/png': new Blob(['png-bytes'], { type: 'image/png' }),
    });

    expect(item.types).toEqual(['text/plain', 'text/html', 'image/png']);
    await expect((await item.getType('text/plain')).text()).resolves.toBe('from a promise');
    await expect((await item.getType('text/html')).text()).resolves.toBe('<b>inline</b>');
    expect((await item.getType('image/png')).type).toBe('image/png');
    await expect(item.getType('text/uri-list')).rejects.toThrow(/not one of the available MIME types/);
  });
});

describe("Monaco's WebKit clipboard workaround under jsdom", () => {
  it('cancels pending writes on repeated clicks without unhandled rejections', async () => {
    // Test the real service that owns the workaround, not JSON tokenization or
    // every language/worker loaded by the application's Monaco configuration.
    // Owning this instance also lets us remove its global listeners afterwards.
    const clipboard = new BrowserClipboardService(
      { mainContainer: document.body, onDidAddContainer: () => ({ dispose() {} }) },
      { trace: vi.fn(), error: vi.fn() }
    );
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'write');
    try {
      render(
        <button data-testid="clipboard-probe" type="button">
          probe
        </button>
      );

      for (let click = 0; click < 3; click += 1) {
        await user.click(screen.getByTestId('clipboard-probe'));
      }
      await settle();

      expect(
        write.mock.calls.length,
        'Monaco no longer writes to the clipboard on click; this guard no longer exercises the workaround'
      ).toBeGreaterThanOrEqual(2);
      // Settle the final deferred write as well; prior clicks must reject their
      // readers, while the last click remains usable by a subsequent copy action.
      const firstItem = write.mock.calls[0]?.[0][0];
      const lastItem = write.mock.calls.at(-1)?.[0][0];
      expect(firstItem).toBeDefined();
      expect(lastItem).toBeDefined();
      await expect(firstItem!.getType('text/plain')).rejects.toThrow();
      await clipboard.writeText('last write');
      await expect((await lastItem!.getType('text/plain')).text()).resolves.toBe('last write');
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      clipboard.dispose();
      write.mockRestore();
    }
  });
});
