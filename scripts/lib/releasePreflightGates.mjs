/**
 * Canonical release-gate registry — the single source of truth shared by
 * `release-preflight.mjs` (which RUNS these locally, CI-faithfully) and
 * `tests/scripts/releasePreflight.test.ts` (the anti-drift guard that asserts
 * every release-blocking gate the workflows run is either covered by the
 * preflight or explicitly marked CI-only).
 *
 * Why this exists: the v0.7.0 release broke twice — once on a gate whose logic
 * differed local-vs-CI (license rotation read a gitignored `.env`), once on an
 * infra gate (R2 public access / CORS) that only ran AFTER build + publish.
 * Neither was catchable before release. The preflight closes that by running
 * the runnable gates the way CI runs them; this registry stops the preflight
 * from silently drifting out of sync with the workflow.
 */

/**
 * @typedef {object} PreflightGate
 * @property {string} id        Stable id.
 * @property {string} label     Human label for the summary table.
 * @property {string[]} argv     Command to spawn (relative to repo root).
 * @property {string | null} script  The npm script this gate corresponds to, for
 *   the workflow drift guard. Declared explicitly (NOT inferred from argv)
 *   because some gates run via `node …` directly — e.g. license-rotation runs
 *   `node assert-license-key-rotation.mjs --env <absent>` to reproduce CI's
 *   missing `.env`, yet its workflow form is `pnpm run check:license-rotation`.
 *   null for gates with no named script (e.g. `tsc --noEmit`).
 * @property {boolean} [heavy]   Skipped under `--fast` (slow / needs a build).
 * @property {boolean} [optional] Skipped unless explicitly opted in.
 * @property {string} [note]     Why this gate is CI-faithful / what it catches.
 */

/**
 * The gates the preflight runs locally, in order. `__TAG__` and `__NO_ENV__`
 * are placeholders the runner substitutes (the target tag, and a path that does
 * not exist — to reproduce CI's absent `.env` for the rotation gate).
 *
 * @type {ReadonlyArray<PreflightGate>}
 */
export const PREFLIGHT_GATES = [
  { id: 'lint', label: 'Lint', script: 'lint', argv: ['pnpm', 'run', 'lint'] },
  { id: 'typecheck', label: 'Type check (src)', script: null, argv: ['pnpm', 'exec', 'tsc', '--noEmit'] },
  { id: 'typecheck:tests', label: 'Type check (test guards)', script: 'typecheck:tests', argv: ['pnpm', 'run', 'typecheck:tests'] },
  { id: 'check:i18n', label: 'i18n keys', script: 'check:i18n', argv: ['pnpm', 'run', 'check:i18n'] },
  { id: 'check:i18n:copy', label: 'i18n copy guard', script: 'check:i18n:copy', argv: ['pnpm', 'run', 'check:i18n:copy'] },
  {
    id: 'changelog:check',
    label: 'Changelog / version guard',
    script: 'changelog:check',
    argv: ['pnpm', 'run', 'changelog:check', '--', '--release-tag', '__TAG__'],
    note: 'asserts package.json + CHANGELOG top == the target tag',
  },
  {
    id: 'check:license-rotation',
    label: 'License-key rotation (CI-faithful, no .env)',
    script: 'check:license-rotation',
    argv: ['node', './scripts/assert-license-key-rotation.mjs', '--env', '__NO_ENV__'],
    note: 'runs with an absent .env to reproduce CI exactly (the v0.7.0 run-1 break)',
  },
  { id: 'check:prod-audit', label: 'Production dependency audit', script: 'check:prod-audit', argv: ['pnpm', 'run', 'check:prod-audit'] },
  { id: 'check:licenses', label: 'Third-party license policy', script: 'check:licenses', argv: ['pnpm', 'run', 'check:licenses'] },
  { id: 'check:performance', label: 'Performance budget', script: 'check:performance', argv: ['pnpm', 'run', 'check:performance'] },
  { id: 'compliance:release', label: 'Release compliance artifacts', script: 'compliance:release', argv: ['pnpm', 'run', 'compliance:release'] },
  {
    id: 'check:release-infra',
    label: 'R2 web-runtime mirror readiness (public + CORS)',
    script: 'check:release-infra',
    argv: ['pnpm', 'run', 'check:release-infra', '--', '--allow-missing-base'],
    note: 'probes the public R2 mirror for 403 / missing CORS (the v0.7.0 run-2 break)',
  },
  { id: 'test', label: 'Unit + integration tests', script: 'test', argv: ['pnpm', 'test'], heavy: true },
  { id: 'build:web', label: 'Production web build', script: 'build:web', argv: ['pnpm', 'run', 'build:web'], heavy: true },
  {
    id: 'smoke:desktop:offline',
    label: 'Desktop smoke (offline, dev server)',
    script: 'smoke:desktop:offline',
    argv: ['pnpm', 'run', 'smoke:desktop:offline'],
    optional: true,
    heavy: true,
    note: 'opt-in (--with-smoke); the packaged-.app subset is CI-only',
  },
];

/**
 * Release-blocking gates the workflows run that the LOCAL preflight cannot
 * reproduce (they need a published release, the built signed `.app`, the
 * staging update feed, or R2 write creds). The drift test allows these to
 * appear in the workflows without a preflight entry — but anything NOT here and
 * NOT a preflight gate fails the test, forcing a conscious decision.
 *
 * @type {ReadonlyArray<string>}
 */
export const CI_ONLY_GATE_SCRIPTS = [
  'check:update-feed', // needs the staging update feed + draft channel
  'check:r2-mirror', // needs the published GitHub Release + R2 write
  'smoke:desktop', // full 9-case matrix against the dev server (pre-merge CI)
  'smoke:desktop:packaged', // needs the built, signed macOS .app
  'smoke:desktop:stagewright',
];

/** npm script names the preflight covers (used by the drift guard). */
export const PREFLIGHT_GATE_SCRIPTS = PREFLIGHT_GATES.map((gate) => gate.script).filter(
  (script) => script !== null
);
