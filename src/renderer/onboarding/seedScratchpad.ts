/**
 * RL-101 Onboarding Choreography Slice 1 — pre-seeded JS scratchpad.
 *
 * On a fresh install (zero persisted tabs, `hasCompletedOnboardingWelcome
 * !== true`, `onboardingWelcomeSeedVersion !== SEEDED_SCRATCHPAD_VERSION`)
 * `useOnboardingChoreography` mounts this snippet as the user's first
 * tab so the welcome experience is "press Cmd+Enter and see real output"
 * instead of "stare at a template grid and bounce".
 *
 * The snippet is intentionally:
 *  - Pure JavaScript (Worker runtime, no Pro gate, no Node, no fetch).
 *  - Free of external dependencies and global side effects.
 *  - Short enough to fit in the editor without scrolling on 720p.
 *  - Anchored on `console.table()` because the rich-output table renders
 *    immediately in the console panel — the most "this app is alive"
 *    moment a Lingua user can have on the first try.
 *
 * Fold E (seed versioning): bump `SEEDED_SCRATCHPAD_VERSION` whenever
 * we materially change the snippet. The hook re-seeds existing users
 * once when their persisted `onboardingWelcomeSeedVersion` is older
 * than the constant here, so demo improvements actually reach the
 * installed base instead of only new installs.
 */

export const SEEDED_SCRATCHPAD_VERSION = 1 as const;
export const SEEDED_SCRATCHPAD_NAME = 'welcome.js';
export const SEEDED_SCRATCHPAD_LANGUAGE = 'javascript';
export const SEEDED_SCRATCHPAD_SOURCE = `// Welcome to Lingua — press Cmd+Enter (or Ctrl+Enter on Linux/Windows).
const fruits = [
  { name: 'banana', kcal: 89 },
  { name: 'apple', kcal: 52 },
  { name: 'mango', kcal: 60 },
];
const sorted = [...fruits].sort((a, b) => a.kcal - b.kcal);
console.table(sorted);
`;
