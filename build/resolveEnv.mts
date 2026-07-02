import { loadEnv } from 'vite';

/**
 * Shared build-time env resolution for the Vite configs (RL-061 fallout,
 * deep-review A2).
 *
 * The main-process bundle reads env at CONFIG-LOAD time (its `define`
 * block is built before Vite's automatic env loading applies), so every
 * env-sourced define must consult four sources, in priority order:
 *
 *   1. `process.env.NAME`        — runtime override (dev launchers)
 *   2. `process.env.VITE_NAME`   — runtime override, VITE alias
 *   3. `.env*` file `NAME`       — repo-root `.env` / `.env.production`
 *   4. `.env*` file `VITE_NAME`  — repo-root, VITE alias
 *
 * Before this helper the cascade lived inline in `vite.main.config.mts`,
 * copied per variable — the exact shape that produced the RL-061
 * `no-public-key` production incident (a variable wired in one config but
 * not another, masked in dev because the launchers inject `process.env`).
 * One implementation + the drift test in
 * `tests/build/envDefineWiring.test.ts` replace the "audit all three
 * configs by hand" landmine documented in AGENTS.md.
 *
 * Renderer/web configs do NOT need this for `import.meta.env.VITE_*`
 * consumers — that substitution is Vite's own env loading, which works as
 * long as `envDir` points at the repo root (also pinned by the drift
 * test). This helper is only for defines resolved at config-load time.
 */

/** Load the repo-root `.env` / `.env.<mode>` files once per config eval. */
export function loadRepoRootEnv(
  mode: string,
  repoRootDir: string
): Record<string, string> {
  return loadEnv(mode, repoRootDir, '');
}

/**
 * Resolve one build-time variable through the four-source cascade.
 * Returns `''` when no source provides it — configs bake the empty
 * string so consumers fail closed (`no-public-key`, `disabled`) instead
 * of crashing.
 */
export function resolveBuildTimeEnvVar(
  fileEnv: Record<string, string>,
  name: string
): string {
  return (
    process.env[name] ||
    process.env[`VITE_${name}`] ||
    fileEnv[name] ||
    fileEnv[`VITE_${name}`] ||
    ''
  );
}
