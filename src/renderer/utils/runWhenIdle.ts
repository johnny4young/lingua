/**
 * Run `callback` once the browser is idle, falling back to a macrotask
 * where `requestIdleCallback` is missing (Safari, jsdom). The 2 s timeout
 * guarantees the work still happens on a busy main thread. Returns cleanup
 * for owners that unmount before the callback runs.
 */
export function runWhenIdle(callback: () => void): () => void {
  const idle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === 'function') {
    const id = idle.call(globalThis, callback, { timeout: 2000 });
    return () => globalThis.cancelIdleCallback?.(id);
  } else {
    const id = setTimeout(callback, 0);
    return () => clearTimeout(id);
  }
}
