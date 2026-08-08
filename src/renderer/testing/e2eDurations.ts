/**
 * Deterministic duration override for the visual-evidence specs.
 *
 * The launch-story gallery is captured from real runs, and the one thing a
 * real run cannot reproduce byte-for-byte is its own measured duration: the
 * notebook cell badge and the HTTP response meta each render a wall-clock
 * number that differs every time. Masking them in the screenshot would ship
 * marketing images with holes; faking the page clock wholesale would freeze
 * every timer in the app. Pinning the number at the measurement site, only
 * when a spec asks for it, keeps the capture honest everywhere else.
 *
 * A spec opts in via addInitScript BEFORE navigation:
 *
 *   await page.addInitScript(() => {
 *     (window as { __linguaE2eFixedDurationMs?: number }).__linguaE2eFixedDurationMs = 12;
 *   });
 *
 * Production builds compile the __LINGUA_E2E_HOOKS__ define to false, so this
 * folds to the identity function and the window read disappears. This module
 * deliberately imports NOTHING: it is consumed by hot paths (httpClient, the
 * notebook runner) whose initial-graph weight is budgeted, and an import here
 * would drag whatever it references into those graphs.
 */
export function e2eFixedDurationMs(measuredMs: number): number {
  if (!__LINGUA_E2E_HOOKS__) return measuredMs;
  const fixed = (window as { __linguaE2eFixedDurationMs?: unknown }).__linguaE2eFixedDurationMs;
  return typeof fixed === 'number' ? fixed : measuredMs;
}
