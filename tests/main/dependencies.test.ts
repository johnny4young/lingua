/**
 * RL-025 Slice A - main-side dependency resolver tests.
 *
 * Pins specifier validation (no path traversal, npm-shape regex),
 * the `node_modules/<scope>/<pkg>` walk for scoped packages, and
 * the soft-fail behaviour when a cwd cannot be resolved.
 */

import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
  },
}));

describe('resolveJsDependencyBatch', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-dep-test-'));
    mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('returns `installed` for a name that exists under node_modules', async () => {
    mkdirSync(path.join(workdir, 'node_modules', 'lodash'));
    writeFileSync(path.join(workdir, 'package.json'), '{}');
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch(
      ['lodash'],
      path.join(workdir, 'app.js')
    );
    expect(result.statuses.lodash).toBe('installed');
  });

  it('returns `detected` for a name that does NOT exist', async () => {
    writeFileSync(path.join(workdir, 'package.json'), '{}');
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch(
      ['ghost-pkg'],
      path.join(workdir, 'app.js')
    );
    expect(result.statuses['ghost-pkg']).toBe('detected');
  });

  it('walks scoped packages into `node_modules/<scope>/<pkg>`', async () => {
    mkdirSync(path.join(workdir, 'node_modules', '@scope', 'pkg'), {
      recursive: true,
    });
    writeFileSync(path.join(workdir, 'package.json'), '{}');
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch(
      ['@scope/pkg'],
      path.join(workdir, 'app.js')
    );
    expect(result.statuses['@scope/pkg']).toBe('installed');
  });

  it('refuses path-traversal specifiers', async () => {
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch(
      ['../../../etc/passwd', './local', 'good'],
      path.join(workdir, 'app.js')
    );
    expect(result.statuses['../../../etc/passwd']).toBeUndefined();
    expect(result.statuses['./local']).toBeUndefined();
    expect(result.statuses.good).toBe('detected');
  });

  it('refuses oversized + non-string specifiers without crashing', async () => {
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch(
      ['x'.repeat(300), 42 as unknown as string, null as unknown as string, 'lodash'],
      path.join(workdir, 'app.js')
    );
    // Only the valid entry shows up.
    expect(Object.keys(result.statuses)).toEqual(['lodash']);
  });

  it('returns a non-null cwd for a saved filePath', async () => {
    const { resolveJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = resolveJsDependencyBatch([], path.join(workdir, 'app.js'));
    expect(typeof result.cwd === 'string').toBe(true);
  });
});
