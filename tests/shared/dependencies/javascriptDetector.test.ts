/**
 * RL-025 Slice A — JS / TS dependency detector tests.
 *
 * Covers the AC enumeration from `docs/PLAN.md § RL-025` (comments,
 * strings, relative imports, Node built-ins, scoped packages) plus
 * the AST + regex-fallback split surfaced by the implementation.
 */

import { describe, expect, it } from 'vitest';
import {
  detectJavaScriptDependencies,
  javascriptDependencyAdapter,
  typescriptDependencyAdapter,
} from '../../../src/shared/dependencies/javascriptDetector';

describe('detectJavaScriptDependencies', () => {
  it('returns an empty array for an empty buffer', () => {
    expect(detectJavaScriptDependencies('')).toEqual([]);
  });

  it('extracts a plain ES module import', () => {
    const result = detectJavaScriptDependencies(
      "import { sortBy } from 'lodash';"
    );
    expect(result).toEqual([{ name: 'lodash', kind: 'import' }]);
  });

  it('extracts default + named imports', () => {
    const result = detectJavaScriptDependencies(
      "import React, { useState } from 'react';"
    );
    expect(result.map((d) => d.name)).toEqual(['react']);
  });

  it('handles scoped packages', () => {
    const result = detectJavaScriptDependencies(
      "import { z } from '@scope/pkg';"
    );
    expect(result).toEqual([{ name: '@scope/pkg', kind: 'import' }]);
  });

  it('normalises submodules to the top-level package', () => {
    const result = detectJavaScriptDependencies(
      "import { fp } from 'lodash/fp';\nimport x from '@scope/pkg/sub';"
    );
    expect(result).toEqual([
      { name: 'lodash', submodule: 'fp', kind: 'import' },
      { name: '@scope/pkg', submodule: 'sub', kind: 'import' },
    ]);
  });

  it('skips relative + absolute paths', () => {
    const result = detectJavaScriptDependencies(
      "import './a';\nimport '../b';\nimport '/c';"
    );
    expect(result).toEqual([]);
  });

  it('skips Node built-ins including the `node:` prefix', () => {
    const result = detectJavaScriptDependencies(
      "import fs from 'fs';\nimport path from 'node:path';\nimport http from 'http';"
    );
    expect(result).toEqual([]);
  });

  it('skips node:-only built-ins without hiding same-named packages', () => {
    const result = detectJavaScriptDependencies(
      "import test from 'node:test';\nimport sqliteCore from 'node:sqlite';\nimport sqlite from 'sqlite';"
    );
    expect(result).toEqual([{ name: 'sqlite', kind: 'import' }]);
  });

  it('handles dynamic `import()` with a literal', () => {
    const result = detectJavaScriptDependencies(
      "const m = await import('chalk');"
    );
    expect(result).toEqual([{ name: 'chalk', kind: 'import' }]);
  });

  it('handles `require()` with a literal', () => {
    const result = detectJavaScriptDependencies("const x = require('mocha');");
    expect(result).toEqual([{ name: 'mocha', kind: 'require' }]);
  });

  it('skips dynamic specifiers (variable + template)', () => {
    const result = detectJavaScriptDependencies(
      "const name = 'lodash'; const a = require(name); const b = await import(`pkg-${suffix}`);"
    );
    // The variable specifier is skipped; the template literal contains
    // no static `name` field for splitSpecifier to extract.
    expect(result).toEqual([]);
  });

  it('does NOT extract imports written inside string literals', () => {
    const result = detectJavaScriptDependencies(
      "const s = \"import { x } from 'lodash'\"; const t = 'require(\"react\")';"
    );
    expect(result).toEqual([]);
  });

  it('falls back to regex sweep on a partial buffer', () => {
    // Truncated mid-expression - acorn will throw; regex picks up the
    // import line that has already been typed.
    const result = detectJavaScriptDependencies(
      "import { sortBy } from 'lodash';\nconst x = sortBy([3,1,2");
    expect(result).toEqual([{ name: 'lodash', kind: 'import' }]);
  });

  it('extracts export ... from declarations', () => {
    const result = detectJavaScriptDependencies(
      "export { sortBy } from 'lodash';\nexport * from 'react';"
    );
    expect(result.map((d) => d.name).sort()).toEqual(['lodash', 'react']);
  });

  it('extracts TypeScript export type declarations through the fallback scanner', () => {
    const result = detectJavaScriptDependencies(
      "export type { Schema } from 'zod';\nexport type * from '@scope/types';"
    );
    expect(result.map((d) => d.name).sort()).toEqual(['@scope/types', 'zod']);
  });

  it('does not treat strings or comments as imports when TypeScript syntax triggers fallback', () => {
    const result = detectJavaScriptDependencies(
      [
        'const note: string = "import fake from \'ghost-string\'";',
        "// require('ghost-comment')",
        "import type { Schema } from 'zod';",
        "const real = require('lodash');",
      ].join('\n')
    );

    expect(result.map((d) => d.name).sort()).toEqual(['lodash', 'zod']);
  });

  it('de-duplicates by name across mixed kinds', () => {
    const result = detectJavaScriptDependencies(
      "import x from 'lodash';\nconst y = require('lodash');"
    );
    expect(result).toEqual([{ name: 'lodash', kind: 'import' }]);
  });

  it('rejects unusual schemes (http:, data:)', () => {
    const result = detectJavaScriptDependencies(
      "import 'http://example.com/m.js';\nimport 'data:text/javascript,';"
    );
    expect(result).toEqual([]);
  });

  it('skips project aliases and package-import specifiers', () => {
    const result = detectJavaScriptDependencies(
      [
        "import Button from '@/components/Button';",
        "import helper from '~/utils/helper';",
        "import config from '#imports';",
        "import sortBy from 'lodash/sortBy';",
      ].join('\n')
    );

    expect(result).toEqual([
      { name: 'lodash', submodule: 'sortBy', kind: 'import' },
    ]);
  });
});

describe('javascript + typescript adapters', () => {
  it('expose the registry-friendly shape', () => {
    expect(javascriptDependencyAdapter.language).toBe('javascript');
    expect(typescriptDependencyAdapter.language).toBe('typescript');
    expect(typeof javascriptDependencyAdapter.detect).toBe('function');
    expect(typeof typescriptDependencyAdapter.detect).toBe('function');
  });

  it('TypeScript adapter accepts TS-ish syntax via the same detector', () => {
    // The detector uses acorn's `latest` ECMA, which now accepts
    // most type-stripped TS — adapter detection should at minimum
    // surface the import even when type annotations follow.
    const result = typescriptDependencyAdapter.detect(
      "import type { Foo } from 'lodash'; import { useState } from 'react';"
    );
    const names = result.map((d) => d.name).sort();
    expect(names).toEqual(['lodash', 'react']);
  });
});
