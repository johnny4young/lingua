/**
 * Deep-review A2 — mechanical gate for the "audit ALL THREE configs" env
 * landmine documented in AGENTS.md.
 *
 * History: internal shipped a production .app where every license paste
 * failed with `no-public-key`, because a new env consumer was wired into
 * one Vite config but not the others — and the dev launchers masked the
 * gap by injecting `process.env` before spawning, so only a packaged
 * build could reveal it. This test turns that class of regression into a
 * CI failure by asserting, against the RESOLVED configs (imported and
 * evaluated, not text-scanned):
 *
 *   1. every `__LINGUA_*__` define consumed by main-process source is
 *      provided by `vite.main.config.mts`;
 *   2. every `__LINGUA_*__` define consumed by renderer-reachable source
 *      (renderer + shared + web + workers) is provided by BOTH
 *      `vite.renderer.config.mts` (packaged desktop) and
 *      `vite.web.config.mts` (web deploy);
 *   3. every `__LINGUA_*__` define consumed by the CLI is provided by
 *      `scripts/build-cli.mjs`;
 *   4. both renderer-facing configs pin `envDir` to the repo root so
 *      `import.meta.env.VITE_*` substitution reads the canonical
 *      `.env` / `.env.production` files.
 *
 * NOTE: the define-name regex includes digits (`SHA256`), which a naive
 * `[A-Z_]+` silently misses.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import mainConfigExport from '../../vite.main.config.mts';
import rendererConfigExport from '../../vite.renderer.config.mts';
import webConfigExport from '../../vite.web.config.mts';

const ROOT = resolve(__dirname, '../..');

const DEFINE_PATTERN = /__LINGUA_[A-Z0-9_]+__/g;

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith('.d.ts')) {
      // .d.ts files DECLARE define identifiers ambiently for the whole
      // renderer; they are not consumers, so they are excluded — a
      // declared-but-provided-nowhere identifier still fails here the
      // moment real code reads it.
      out.push(full);
    }
  }
  return out;
}

function collectConsumedDefines(...dirs: string[]): Set<string> {
  const consumed = new Set<string>();
  for (const dir of dirs) {
    for (const file of walkSourceFiles(resolve(ROOT, dir))) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(DEFINE_PATTERN)) {
        // Skip QUOTED occurrences: Vite/esbuild `define` replaces bare
        // identifiers only, so a string like
        // `const SENTINEL = '__LINGUA_PYODIDE_LOAD_CANCELLED__'` is a
        // runtime sentinel value, not a build-time define consumer.
        const before = text[match.index - 1] ?? '';
        const after = text[match.index + match[0].length] ?? '';
        const quotes = new Set(["'", '"', '`']);
        if (quotes.has(before) && quotes.has(after)) continue;
        consumed.add(match[0]);
      }
    }
  }
  return consumed;
}

type ResolvedConfig = {
  define?: Record<string, unknown>;
  envDir?: string;
};

async function resolveConfig(
  configExport: unknown,
  mode: string
): Promise<ResolvedConfig> {
  if (typeof configExport === 'function') {
    return (await configExport({
      command: 'build',
      mode,
      isSsrBuild: false,
      isPreview: false,
    })) as ResolvedConfig;
  }
  return configExport as ResolvedConfig;
}

function defineKeys(config: ResolvedConfig): Set<string> {
  return new Set(Object.keys(config.define ?? {}));
}

function missingFrom(consumed: Set<string>, provided: Set<string>): string[] {
  return [...consumed].filter((name) => !provided.has(name)).sort();
}

describe('env/define wiring across build configs (AGENTS.md landmine gate)', () => {
  it('vite.main.config provides every define main-process source consumes', async () => {
    const consumed = collectConsumedDefines('src/main');
    const provided = defineKeys(await resolveConfig(mainConfigExport, 'production'));
    expect(
      missingFrom(consumed, provided),
      'main-process code reads build-time defines that vite.main.config.mts never injects — a packaged build will bake `undefined`. Wire them through the define block (see build/resolveEnv.mts for env-sourced values).'
    ).toEqual([]);
  });

  it('BOTH renderer-facing configs provide every define renderer-reachable source consumes', async () => {
    const consumed = collectConsumedDefines(
      'src/renderer',
      'src/shared',
      'src/web'
    );
    const rendererProvided = defineKeys(
      await resolveConfig(rendererConfigExport, 'production')
    );
    const webProvided = defineKeys(await resolveConfig(webConfigExport, 'production'));

    expect(
      missingFrom(consumed, rendererProvided),
      'renderer/shared/web code reads defines vite.renderer.config.mts never injects — the packaged DESKTOP renderer will bake `undefined` (dev launchers mask this; only a make:desktop build would reveal it).'
    ).toEqual([]);
    expect(
      missingFrom(consumed, webProvided),
      'renderer/shared/web code reads defines vite.web.config.mts never injects — the WEB deploy will bake `undefined`.'
    ).toEqual([]);
  });

  it('the CLI bundle defines every identifier src/cli consumes', () => {
    const consumed = collectConsumedDefines('src/cli');
    const buildScript = readFileSync(resolve(ROOT, 'scripts/build-cli.mjs'), 'utf-8');
    const provided = new Set(
      [...buildScript.matchAll(DEFINE_PATTERN)].map((match) => match[0])
    );
    expect(
      missingFrom(consumed, provided),
      'CLI code reads defines scripts/build-cli.mjs never injects.'
    ).toEqual([]);
  });

  it('renderer + web configs pin envDir to the repo root so import.meta.env.VITE_* substitution works in packaged builds', async () => {
    const renderer = await resolveConfig(rendererConfigExport, 'production');
    const web = await resolveConfig(webConfigExport, 'production');
    // `envDir` must be the repo root, where .env / .env.production live.
    // Without the pin, Forge (renderer) or `root: src/web` (web) shift
    // Vite's default env resolution and every VITE_* substitution
    // silently becomes `undefined` — the exact implementation bug.
    expect(renderer.envDir, 'vite.renderer.config.mts must pin envDir to the repo root').toBe(ROOT);
    expect(web.envDir, 'vite.web.config.mts must pin envDir to the repo root').toBe(ROOT);
  });

  it('vite.main.config resolves env-sourced defines through the shared cascade helper', () => {
    // The four-source cascade (process.env NAME / VITE_NAME, .env file
    // NAME / VITE_NAME) must not be hand-copied per variable — that copy
    // pattern is how a variable ends up consulting three sources in one
    // config and two in another. Pin the helper import so a future edit
    // that reverts to inline `process.env.X || env.X` chains fails here.
    const configText = readFileSync(resolve(ROOT, 'vite.main.config.mts'), 'utf-8');
    expect(configText).toContain('resolveBuildTimeEnvVar');
    expect(configText).toContain("from './build/resolveEnv.mts'");
  });
});
