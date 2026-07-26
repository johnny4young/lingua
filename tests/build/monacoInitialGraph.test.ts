/**
 * Keeps Monaco out of the initial download.
 *
 * Monaco is ~3.7 MiB raw / ~950 KiB gzip — larger than everything else in the
 * initial graph combined. It has regressed into that graph before, silently,
 * because two independent mechanisms can put it there and neither shows up in
 * a code review of the diff that caused it:
 *
 *   1. A module reachable by STATIC import from the web entry importing the
 *      `src/renderer/monaco` barrel. `useDocumentSymbols` did this while its
 *      own doc comment claimed the opposite, reached from `<AppOverlays>`.
 *   2. Vite's `\0vite/preload-helper.js` — a ~1 KiB shared module every chunk
 *      with a dynamic import needs — getting absorbed into the monaco chunk by
 *      automatic placement. The entry then statically imports that chunk for
 *      the helper and drags the editor along.
 *
 * These tests guard both. The bundle-size side is covered separately by the
 * performance budget in `docs/performance/baseline.json`.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

/** Entry module for each bundled surface, relative to the repo root. */
const ENTRIES = {
  web: 'src/web/main.tsx',
  renderer: 'src/renderer/main.tsx',
} as const;

/** The barrel that pulls monaco core, the five ?worker bundles and the React wrapper. */
const MONACO_BARREL = 'src/renderer/monaco.ts';

/**
 * Modules that must stay on the far side of a lazy boundary, with the reason
 * each one costs real bytes at boot. All of them are reached only through
 * `<AppOverlays>`, which `App` mounts unconditionally — so a plain `import`
 * there silently puts them in every visitor's first download.
 */
const MUST_STAY_LAZY: Array<{ module: string; why: string }> = [
  { module: 'src/renderer/data/changelog.ts', why: '77 KiB of release copy' },
  { module: 'src/renderer/components/Settings/SettingsModal.tsx', why: 'the whole Settings tree' },
  {
    module: 'src/renderer/components/CommandPalette/CommandPalette.tsx',
    why: 'the 30 KiB palette model',
  },
  {
    module: 'src/renderer/components/CapsuleList/CapsuleListOverlay.tsx',
    why: 'capsule browsing + comparison',
  },
  {
    module: 'src/renderer/components/ImportPreview/ImportPreviewOverlay.tsx',
    why: 'the Postman/Bruno importers',
  },
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve a relative specifier the way the bundler does: exact file, then
 * extension probing, then `index.*`. Returns null for anything that is not a
 * repo-relative source file (bare package specifiers, css, assets).
 */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(path.join(repoRoot, fromFile)), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map(ext => base + ext),
    ...EXTENSIONS.map(ext => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate).length >= 0) {
          const rel = path.relative(repoRoot, candidate);
          if (EXTENSIONS.some(ext => rel.endsWith(ext))) return rel;
        }
      } catch {
        // Directory or unreadable — keep probing.
      }
    }
  }
  return null;
}

/**
 * Strip comments the way the parser would, tracking string literals so a `//`
 * inside a quoted URL is not mistaken for one.
 *
 * A regex-only strip is not enough. The specifier patterns below are anchored
 * at a line-start `import`, which correctly ignores a whole line that starts
 * with `//` — but the lazy `[\s\S]*?` still scans forward for the first
 * `from '...'`, so a comment *inside* a multi-line import statement leaks its
 * text as if it were the real specifier:
 *
 *     import {
 *       a,
 *       // b from '../monaco'
 *     } from './real';
 *
 * That capture is `../monaco`, and the guard would fail on a module nobody
 * imports.
 */
export function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') {
        out += char + (next ?? '');
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue; // the newline itself is copied by the next iteration
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Static specifiers only. `import type` / `export type` are erased before the
 * bundler sees them, and `import(...)` is the lazy boundary we are trying to
 * preserve — counting either would make this test assert the opposite of what
 * it means to.
 */
export function staticSpecifiers(source: string): string[] {
  const withoutBlockComments = stripComments(source);
  const specifiers: string[] = [];
  // `[^;]` rather than `[\s\S]`: the lazy scan must not cross a statement
  // boundary. With `[\s\S]*?`, a side-effect import reaches past its own
  // semicolon and captures the NEXT statement's specifier —
  // `import './a';` followed by `import type { T } from './b';` yielded
  // `./b`, an edge that does not exist. An import clause never contains a
  // semicolon, so nothing legitimate is lost.
  const importRe = /^\s*import\s+(?!type\s)([^;]*?)from\s*['"]([^'"]+)['"]/gm;
  const bareImportRe = /^\s*import\s*['"]([^'"]+)['"]/gm;
  const reExportRe = /^\s*export\s+(?!type\s)([^;]*?)from\s*['"]([^'"]+)['"]/gm;

  for (const match of withoutBlockComments.matchAll(importRe)) {
    // `import { type A, b }` still imports a value; `import { type A }` does
    // not, but treating it as one only ever makes this test stricter.
    specifiers.push(match[2]!);
  }
  for (const match of withoutBlockComments.matchAll(bareImportRe)) {
    specifiers.push(match[1]!);
  }
  for (const match of withoutBlockComments.matchAll(reExportRe)) {
    specifiers.push(match[2]!);
  }
  return specifiers;
}

/**
 * Bare (package) specifiers that must never appear on a statically-reachable
 * path. These are the on-demand halves of the editor: a syntax tokenizer or a
 * language worker belongs to the language the user actually selected, not to
 * everyone's first download.
 */
const FORBIDDEN_BARE_PREFIXES = [
  'monaco-editor/esm/vs/basic-languages/',
  'monaco-editor/esm/vs/language/',
];

/**
 * Every source file reachable from `entry` following static imports only.
 * Dynamic `import()` calls terminate a branch, which is exactly the lazy
 * boundary the bundler honours.
 */
function staticallyReachable(
  entry: string,
  bareHits?: Map<string, string>
): Map<string, string | null> {
  const seen = new Map<string, string | null>(); // file -> importer
  const queue: Array<[string, string | null]> = [[entry, null]];
  while (queue.length > 0) {
    const [file, importer] = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, importer);
    let source: string;
    try {
      source = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    for (const specifier of staticSpecifiers(source)) {
      if (bareHits && !specifier.startsWith('.')) {
        for (const prefix of FORBIDDEN_BARE_PREFIXES) {
          if (specifier.startsWith(prefix) && !bareHits.has(specifier)) {
            bareHits.set(specifier, file);
          }
        }
      }
      const resolved = resolveImport(file, specifier);
      if (resolved && !seen.has(resolved)) queue.push([resolved, file]);
    }
  }
  return seen;
}

/** Walk importer links back to the entry so a failure names the actual chain. */
function importChain(reachable: Map<string, string | null>, target: string): string {
  const chain: string[] = [];
  let current: string | undefined | null = target;
  while (current) {
    chain.unshift(current);
    current = reachable.get(current) ?? null;
  }
  return chain.join('\n  -> ');
}

describe('Monaco stays out of the initial graph', () => {
  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: no statically-reachable module imports the monaco barrel`, () => {
      const reachable = staticallyReachable(entry);
      // Sanity: the walker actually walked. Without this a resolution bug
      // would make the real assertion below pass on an empty graph.
      expect(reachable.size).toBeGreaterThan(50);
      expect(reachable.has('src/renderer/App.tsx')).toBe(true);

      if (reachable.has(MONACO_BARREL)) {
        throw new Error(
          `${MONACO_BARREL} is statically reachable from ${entry}, which parks ` +
            `~950 KiB gzip of editor in the initial download. Make the ` +
            `dependency dynamic (await import('../monaco')) or move the ` +
            `consumer behind a lazy boundary.\n\nChain:\n  ` +
            importChain(reachable, MONACO_BARREL)
        );
      }
    });
  }

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: overlay-only modules stay behind a lazy boundary`, () => {
      const reachable = staticallyReachable(entry);
      const leaked = MUST_STAY_LAZY.filter(target => reachable.has(target.module));
      if (leaked.length > 0) {
        throw new Error(
          leaked
            .map(
              target =>
                `${target.module} (${target.why}) is statically reachable from ${entry}.\n` +
                `Chain:\n  ${importChain(reachable, target.module)}`
            )
            .join('\n\n')
        );
      }
    });
  }

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: syntax tokenizers and language workers load on demand`, () => {
      // Verified in a production build: switching a tab to Python fetches the
      // tokenizer, its three providers and the worker at that moment, and
      // none of them ships at boot.
      //
      // Scope: this polices the BOOT path. `basicLanguageLoaders` itself sits
      // behind the Monaco boundary and is not statically reachable, so a
      // static import there costs nothing and is not what this catches. What
      // it catches is a boot-path module — App, a store, a always-mounted
      // component — reaching for a tokenizer or worker directly.
      const bareHits = new Map<string, string>();
      staticallyReachable(entry, bareHits);
      if (bareHits.size > 0) {
        throw new Error(
          [...bareHits]
            .map(([specifier, importer]) => `${specifier}\n    imported by ${importer}`)
            .join('\n') +
            `\n\nThese must stay behind import() so a visitor only downloads the ` +
            `syntax they selected.`
        );
      }
    });
  }

  describe('the walker itself', () => {
    it('ignores an import that is commented out on its own line', () => {
      expect(
        staticSpecifiers("// import { X } from '../monaco';\nimport { cn } from './cn';\n")
      ).toEqual(['./cn']);
    });

    it('ignores a comment inside a multi-line import statement', () => {
      // Regression: the lazy `[\s\S]*?` used to scan past this comment and
      // capture `../monaco` as the specifier of the real import below it.
      expect(
        staticSpecifiers("import {\n  a,\n  // b from '../monaco'\n} from './real';\n")
      ).toEqual(['./real']);
    });

    it('ignores a block comment wrapping an import', () => {
      expect(
        staticSpecifiers("/*\nimport { X } from '../monaco';\n*/\nimport { cn } from './cn';\n")
      ).toEqual(['./cn']);
    });

    it('does not mistake a // inside a string for a comment', () => {
      expect(staticSpecifiers("import { a } from 'https://example.com/x.js';\n")).toEqual([
        'https://example.com/x.js',
      ]);
    });

    it('still sees the imports it is supposed to see', () => {
      expect(
        staticSpecifiers(
          "import './side-effect';\nimport type { T } from './types';\nexport { z } from './z';\n"
        )
      ).toEqual(['./side-effect', './z']);
    });

    it('does not count dynamic imports as static edges', () => {
      expect(staticSpecifiers("const m = await import('../monaco');\n")).toEqual([]);
    });
  });

  it('both bundled configs pin the Vite preload helper to its own chunk', () => {
    // Without this group rolldown folds `\0vite/preload-helper.js` into the
    // monaco chunk, and the entry's need for a 1 KiB helper becomes a static
    // edge onto the whole editor. `manualChunks` cannot express it: the
    // rollup-compat layer never sees virtual module ids.
    // Comments are stripped first, and the group has to match INSIDE the
    // advancedChunks block in a single pattern. Two independent regexes would
    // both pass on prose that merely mentions the two strings — which is the
    // exact shape of the explanatory comment sitting above this config.
    for (const config of ['vite.web.config.mts', 'vite.renderer.config.mts']) {
      const source = stripComments(readFileSync(path.join(repoRoot, config), 'utf8'));
      expect(source, `${config} lost its advancedChunks preload-helper group`).toMatch(
        /advancedChunks:\s*\{[^}]*groups:\s*\[[^\]]*test:\s*\/preload-helper\//
      );
    }
  });
});
