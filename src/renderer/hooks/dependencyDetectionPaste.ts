const PASTE_RECENCY_MS = 250;
const PASTE_DEBOUNCE_MS = 60;
const KEYSTROKE_DEBOUNCE_MS = 300;

let lastPasteAt = 0;

/**
 * Record an editor paste without importing the dependency-classification
 * runtime into Monaco's own chunk.
 */
export function notifyDependencyDetectionPaste(): void {
  lastPasteAt = Date.now();
}

/** Return the calm edit debounce or the shorter post-paste debounce. */
export function dependencyDetectionDebounceMs(now = Date.now()): number {
  const sincePasteMs = now - lastPasteAt;
  return sincePasteMs >= 0 && sincePasteMs < PASTE_RECENCY_MS
    ? PASTE_DEBOUNCE_MS
    : KEYSTROKE_DEBOUNCE_MS;
}
