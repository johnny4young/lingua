/**
 * Run `callback` once the browser is idle, falling back to a macrotask
 * where `requestIdleCallback` is missing (Safari, jsdom). The 2 s timeout
 * guarantees the work still happens on a busy main thread.
 */
export function runWhenIdle(callback: () => void): void {
  const idle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === 'function') {
    idle(callback, { timeout: 2000 });
  } else {
    setTimeout(callback, 0);
  }
}
