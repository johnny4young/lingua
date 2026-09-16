/**
 * `tsconfig.test.json` declares its own `compilerOptions.paths`, which replaces
 * the root mapping instead of extending it. Without this guard a root alias
 * added or retargeted in `tsconfig.json` would surface only as TS2307 inside
 * `src/**` under `typecheck:tests`, pointing at files the change never touched.
 * It also keeps the test-only `#src` mirror aligned with the vitest alias it
 * copies.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.mts';

const repoRoot = path.resolve(__dirname, '../..');

type PathMap = Record<string, string[]>;

/** Calls `visit` for every character outside a JSON string, copying strings through. */
function mapOutsideStrings(
  text: string,
  visit: (index: number) => { emit: string; next: number }
): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      out += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const { emit, next } = visit(index);
    out += emit;
    index = next;
  }
  return out;
}

/**
 * tsconfig files are JSONC: tsc accepts `//` and block comments and trailing
 * commas, which `JSON.parse` rejects. Both are removed outside strings, so
 * globs such as `src/**\/*.ts` stay intact.
 */
function parseJsonc(text: string): unknown {
  const withoutComments = mapOutsideStrings(text, (index) => {
    if (text.startsWith('//', index)) {
      const lineEnd = text.indexOf('\n', index);
      return { emit: '', next: lineEnd === -1 ? text.length : lineEnd };
    }
    if (text.startsWith('/*', index)) {
      const blockEnd = text.indexOf('*/', index + 2);
      return { emit: '', next: blockEnd === -1 ? text.length : blockEnd + 2 };
    }
    return { emit: text[index]!, next: index + 1 };
  });
  const withoutTrailingCommas = mapOutsideStrings(withoutComments, (index) => {
    const char = withoutComments[index]!;
    const trailing = char === ',' && /^\s*[}\]]/.test(withoutComments.slice(index + 1));
    return { emit: trailing ? '' : char, next: index + 1 };
  });
  return JSON.parse(withoutTrailingCommas);
}

function readPaths(file: string): PathMap {
  const config = parseJsonc(readFileSync(path.join(repoRoot, file), 'utf8')) as {
    compilerOptions?: { paths?: PathMap };
  };
  return config.compilerOptions?.paths ?? {};
}

/**
 * Vite accepts aliases as an object map or as `{ find, replacement }` entries.
 * A RegExp `find` has no `paths` equivalent, so only string finds are compared.
 */
function aliasPairs(alias: unknown): Array<[string, string]> {
  if (alias === undefined) return [];
  if (Array.isArray(alias)) {
    return (alias as Array<{ find: string | RegExp; replacement: string }>).flatMap((entry) =>
      typeof entry.find === 'string' ? [[entry.find, entry.replacement] as [string, string]] : []
    );
  }
  return Object.entries(alias as Record<string, string>);
}

describe('test type-check path aliases', () => {
  const rootPaths = readPaths('tsconfig.json');
  const testPaths = readPaths('tsconfig.test.json');

  it('repeats every root alias with the same targets', () => {
    expect(Object.keys(rootPaths).length).toBeGreaterThan(0);
    for (const [alias, targets] of Object.entries(rootPaths)) {
      expect(testPaths[alias], `tsconfig.test.json does not repeat root alias ${alias}`).toEqual(
        targets
      );
    }
  });

  it('maps every vitest alias to the directory vitest resolves', () => {
    const pairs = aliasPairs(vitestConfig.resolve?.alias);
    expect(pairs.length, 'vitest.config.mts defines no string aliases to compare').toBeGreaterThan(0);
    for (const [alias, directory] of pairs) {
      const target = testPaths[`${alias}/*`]?.[0];
      expect(target, `tsconfig.test.json has no ${alias}/* for the vitest alias`).toBeDefined();
      expect(
        path.resolve(repoRoot, target!.replace(/\/\*$/, '')),
        `${alias}/* in tsconfig.test.json points somewhere other than the vitest alias`
      ).toBe(directory);
    }
  });
});

describe('guard helpers', () => {
  it('reads the JSONC that tsc accepts', () => {
    const text = [
      '{',
      '  // a line comment',
      '  "compilerOptions": {',
      '    /* a block',
      '       comment */',
      '    "paths": {',
      '      "@/*": ["./src/renderer/*"], // trailing comment after a value',
      '      "#src/*": ["./src/*",],',
      '    },',
      '  },',
      '  "include": ["src/**/*.ts", "tests/**/*.tsx"],',
      '}',
    ].join('\n');

    expect(parseJsonc(text)).toEqual({
      compilerOptions: { paths: { '@/*': ['./src/renderer/*'], '#src/*': ['./src/*'] } },
      include: ['src/**/*.ts', 'tests/**/*.tsx'],
    });
  });

  it('leaves comment and comma lookalikes inside strings untouched', () => {
    expect(
      parseJsonc('{ "url": "https://example.test//x", "note": "say \\"hi\\", }", "glob": "a/*b*/c" }')
    ).toEqual({ url: 'https://example.test//x', note: 'say "hi", }', glob: 'a/*b*/c' });
  });

  it('compares the same pairs whether aliases are a map or entries', () => {
    const map = { '@': '/repo/src/renderer', '#src': '/repo/src' };
    const entries = [
      { find: '@', replacement: '/repo/src/renderer' },
      { find: /^~(.*)$/, replacement: '/repo/$1' },
      { find: '#src', replacement: '/repo/src' },
    ];

    expect(aliasPairs(entries)).toEqual(aliasPairs(map));
    expect(aliasPairs(undefined)).toEqual([]);
  });
});
