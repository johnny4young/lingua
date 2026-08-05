import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AUDIT_LEVEL,
  collectBundledPackages,
  collectImportSpecifiers,
  evaluateBundledAudit,
  expandRuntimeClosure,
  formatBundledAuditFailure,
  stripComments,
  toPackageName,
} from '../../scripts/lib/bundledAudit.mjs';

/**
 * Locks the bundled-dependency audit gate.
 *
 * The regression this exists for: `check:prod-audit` runs `pnpm audit --prod`,
 * which only sees package.json `dependencies`. Vite bundles the main/preload
 * graphs, so `undici` (declared a devDependency, imported by
 * src/main/httpProxy.ts) shipped inside `.vite/build/main.js` on 7.28.0 while
 * an advisory required >= 7.29.0 — with the blocking gate reporting green.
 *
 * A live registry advisory cannot be injected, so the acceptance criterion is
 * proven with fixture audit JSON through both the pure evaluator and the real
 * CLI, plus one assertion against the REAL repository scan so the gate cannot
 * quietly stop covering the packages it was built for.
 */

function auditFixture(advisories: Array<{ id: string; severity: string; module: string }>) {
  const advisoryMap: Record<string, unknown> = {};
  for (const a of advisories) {
    advisoryMap[a.id] = {
      id: Number(a.id),
      title: `synthetic ${a.severity} in ${a.module}`,
      module_name: a.module,
      severity: a.severity,
      url: `https://example.test/advisory/${a.id}`,
      findings: [{ version: '1.0.0', paths: [`.>${a.module}`] }],
    };
  }
  return { advisories: advisoryMap };
}

const CLEAN_AUDIT = { advisories: {} };
const BUNDLED = ['undici', 'ws', 'zod'];

describe('stripComments', () => {
  it('removes the JSDoc mention that would otherwise be read as an import', () => {
    // src/main/node-runner.ts documents module resolution with this exact
    // phrasing; a naive regex sweep reports lodash as a bundled dependency.
    const source = `/**\n * so that \`require('lodash')\` resolves\n */\nimport x from 'real-pkg';`;
    expect(collectImportSpecifiers(source)).toEqual(['real-pkg']);
  });

  it('ignores line-comment imports', () => {
    expect(
      collectImportSpecifiers(`// import evil from 'evil-pkg';\nimport ok from 'ok-pkg';`)
    ).toEqual(['ok-pkg']);
  });

  it('preserves string and template contents', () => {
    const source = `const a = "not // a comment"; const b = \`also /* not */ one\`;`;
    expect(stripComments(source)).toContain('not // a comment');
    expect(stripComments(source)).toContain('also /* not */ one');
  });

  it('does not mistake division or regex literals for comments', () => {
    const source = `const ratio = total / count;\nconst re = /https?:\\/\\//u;\nimport z from 'kept';`;
    expect(collectImportSpecifiers(source)).toEqual(['kept']);
  });
});

describe('collectImportSpecifiers', () => {
  it('detects the multi-line named-import form Prettier produces', () => {
    // Anchoring the pattern to the start of a line misses this shape, and a
    // missed import silently narrows the gate.
    const source = `import {\n  createMcpHandler,\n  McpServer,\n} from '@modelcontextprotocol/node';`;
    expect(collectImportSpecifiers(source)).toEqual(['@modelcontextprotocol/node']);
  });

  it('detects side-effect, dynamic, require, and re-export forms', () => {
    const source = [
      `import 'side-effect-pkg';`,
      `const mod = await import('dynamic-pkg');`,
      `const legacy = require('cjs-pkg');`,
      `export { thing } from 'reexport-pkg';`,
    ].join('\n');
    expect(collectImportSpecifiers(source).sort()).toEqual([
      'cjs-pkg',
      'dynamic-pkg',
      'reexport-pkg',
      'side-effect-pkg',
    ]);
  });

  it('excludes type-only imports, which are erased before bundling', () => {
    const source = `import type { Cfg } from 'types-only-pkg';\nimport real from 'runtime-pkg';`;
    expect(collectImportSpecifiers(source)).toEqual(['runtime-pkg']);
  });

  it('keeps a value import that also carries an inline type specifier', () => {
    // `import WebSocket, { type RawData } from 'ws'` still ships ws.
    const source = `import WebSocket, { type RawData } from 'ws';`;
    expect(collectImportSpecifiers(source)).toEqual(['ws']);
  });
});

describe('toPackageName', () => {
  it('maps subpaths and scopes to the installable package name', () => {
    expect(toPackageName('lodash/debounce')).toBe('lodash');
    expect(toPackageName('@scope/pkg/sub/path')).toBe('@scope/pkg');
    expect(toPackageName('undici')).toBe('undici');
  });

  it('rejects relative paths, builtins, and URLs', () => {
    for (const specifier of ['./local', '../up', '/abs', 'node:fs', 'https://cdn.test/x.js', '']) {
      expect(toPackageName(specifier), specifier).toBeNull();
    }
  });
});

describe('collectBundledPackages', () => {
  it('drops packages the Vite config declares external', () => {
    const sources = [`import { app } from 'electron';\nimport { Agent } from 'undici';`];
    expect(collectBundledPackages({ sources, externals: ['electron'] })).toEqual(['undici']);
  });

  it('deduplicates across files and sorts', () => {
    const sources = [`import a from 'ws';`, `import b from 'undici';`, `import c from 'ws';`];
    expect(collectBundledPackages({ sources, externals: [] })).toEqual(['undici', 'ws']);
  });
});

describe('expandRuntimeClosure', () => {
  it('follows transitive dependencies', () => {
    const graph: Record<string, string[]> = { a: ['b'], b: ['c'], c: [] };
    expect(expandRuntimeClosure(['a'], name => graph[name] ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('terminates on cycles', () => {
    const graph: Record<string, string[]> = { a: ['b'], b: ['a'] };
    expect(expandRuntimeClosure(['a'], name => graph[name] ?? [])).toEqual(['a', 'b']);
  });
});

describe('evaluateBundledAudit', () => {
  it('AC: a high advisory on a bundled devDependency fails the gate', () => {
    // The exact historical case: undici is a devDependency that ships.
    const result = evaluateBundledAudit(
      auditFixture([{ id: '301', severity: 'high', module: 'undici' }]),
      BUNDLED
    );
    expect(result.ok).toBe(false);
    expect(result.offending).toHaveLength(1);
    expect(result.offending[0]).toMatchObject({ module: 'undici', severity: 'high' });
  });

  it('ignores a high advisory on a package the bundle does not inline', () => {
    // node-tar and sharp reach the tree only through dev tooling and are
    // documented as deliberate exceptions; this gate must not red-CI on them.
    const result = evaluateBundledAudit(
      auditFixture([
        { id: '302', severity: 'high', module: 'tar' },
        { id: '303', severity: 'critical', module: 'sharp' },
      ]),
      BUNDLED
    );
    expect(result.ok).toBe(true);
    expect(result.offending).toEqual([]);
  });

  it('passes a clean audit and reports what it judged', () => {
    const result = evaluateBundledAudit(CLEAN_AUDIT, BUNDLED);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.audited).toEqual(['undici', 'ws', 'zod']);
    expect(result.level).toBe(DEFAULT_AUDIT_LEVEL);
  });

  it('honours the threshold in both directions', () => {
    const moderate = auditFixture([{ id: '304', severity: 'moderate', module: 'ws' }]);
    expect(evaluateBundledAudit(moderate, BUNDLED).ok).toBe(true);
    expect(evaluateBundledAudit(moderate, BUNDLED, { level: 'moderate' }).ok).toBe(false);
  });

  it('sorts offending advisories worst-first', () => {
    const result = evaluateBundledAudit(
      auditFixture([
        { id: '305', severity: 'high', module: 'ws' },
        { id: '306', severity: 'critical', module: 'undici' },
      ]),
      BUNDLED
    );
    expect(result.offending.map(o => o.severity)).toEqual(['critical', 'high']);
  });

  it('fails closed on a malformed payload', () => {
    for (const bad of [null, undefined, {}, { advisories: null }, { advisories: [] }, 42]) {
      const result = evaluateBundledAudit(bad, BUNDLED);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      expect(result.error).toBe('malformed');
    }
  });

  it('fails closed on an unknown severity or level', () => {
    expect(
      evaluateBundledAudit(
        { advisories: { '307': { module_name: 'ws', severity: 'HIGH' } } },
        BUNDLED
      ).error
    ).toBe('malformed');
    expect(evaluateBundledAudit(CLEAN_AUDIT, BUNDLED, { level: 'bogus' }).error).toBe('malformed');
  });

  it('fails closed when the scan produced no packages', () => {
    // An empty closure means the scanner broke, not that the bundle is clean.
    const result = evaluateBundledAudit(CLEAN_AUDIT, []);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('malformed');
    expect(result.message).toMatch(/broken rather than clean/u);
  });
});

describe('formatBundledAuditFailure', () => {
  it('explains that the package ships despite its declaration', () => {
    const result = evaluateBundledAudit(
      auditFixture([{ id: '308', severity: 'high', module: 'undici' }]),
      BUNDLED
    );
    const report = formatBundledAuditFailure(result);
    expect(report).toContain('[high] undici');
    expect(report).toContain('regardless of how they are declared in package.json');
    expect(report).toContain('pnpm why undici');
    expect(report).toContain('pnpm-workspace.yaml');
  });

  it('returns an empty string when nothing offends', () => {
    expect(formatBundledAuditFailure(evaluateBundledAudit(CLEAN_AUDIT, BUNDLED))).toBe('');
  });
});

describe('scripts/assert-bundled-audit.mjs (CLI)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeFixture(audit: unknown): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-bundled-audit-'));
    tempDirs.push(root);
    const fixturePath = path.join(root, 'audit.json');
    await writeFile(fixturePath, JSON.stringify(audit));
    return fixturePath;
  }

  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        'scripts/assert-bundled-audit.mjs',
        ...args,
      ],
      { encoding: 'utf8' }
    );
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }

  it('AC: a synthetic high advisory on a bundled package exits 1 with a hint', async () => {
    const fixture = await writeFixture(
      auditFixture([{ id: '401', severity: 'high', module: 'undici' }])
    );
    const result = runCli(['--fixture', fixture, '--packages', 'undici,ws']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pnpm why undici');
  });

  it('exits 0 when the offending package is outside the bundle', async () => {
    const fixture = await writeFixture(
      auditFixture([{ id: '402', severity: 'high', module: 'tar' }])
    );
    const result = runCli(['--fixture', fixture, '--packages', 'undici,ws']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bundled-audit: ok');
  });

  it('fails closed on an unparseable fixture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-bundled-bad-'));
    tempDirs.push(root);
    const fixturePath = path.join(root, 'bad.json');
    await writeFile(fixturePath, 'not-json{');
    const result = runCli(['--fixture', fixturePath, '--packages', 'undici']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/could not parse audit JSON/u);
  });

  it('scans the real repository and still covers the packages this gate exists for', () => {
    const result = runCli(['--list']);
    expect(result.status).toBe(0);
    const scanned = result.stdout.trim().split('\n');
    // undici and ws are devDependencies that Vite inlines into main.js. If a
    // refactor stops covering them, this gate has lost its purpose.
    expect(scanned).toContain('undici');
    expect(scanned).toContain('ws');
    // electron/node-pty are declared external and must never appear.
    expect(scanned).not.toContain('electron');
    expect(scanned).not.toContain('node-pty');
    // Documented dev-tooling exceptions must stay out of scope.
    expect(scanned).not.toContain('tar');
    expect(scanned).not.toContain('sharp');
    // The JSDoc `require('lodash')` in src/main/node-runner.ts is not an import.
    expect(scanned).not.toContain('lodash');
  });
});
