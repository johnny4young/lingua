import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.mts';

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

function hasInlineTestConfig(value: unknown): value is { test?: { exclude?: string[] } } {
  return typeof value === 'object' && value !== null && 'test' in value;
}

describe('coverage configuration', () => {
  it('pins the runner and V8 provider to the same exact version', () => {
    expect(pkg.devDependencies.vitest).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBe(pkg.devDependencies.vitest);
  });

  it('keeps coverage opt-in and includes untested application source', () => {
    expect(config.test?.coverage).toMatchObject({
      enabled: false,
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/types.d.ts'],
      reportsDirectory: 'output/coverage',
      reporter: ['text-summary', 'json-summary', 'lcov'],
    });
    // Neither everyday tests nor their budgets may silently lose benchmarks.
    for (const project of config.test?.projects ?? []) {
      if (typeof project !== 'object' || project === null || !('test' in project)) continue;
      expect(project.test?.exclude ?? []).not.toContain('**/*.bench.test.ts');
    }
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('excludes timing benches inside both projects only during coverage', () => {
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    const projects = (config.test?.projects ?? []).filter(hasInlineTestConfig);
    expect(projects).toHaveLength(2);
    for (const project of projects) {
      expect(project.test?.exclude?.includes('**/*.bench.test.ts')).toBe(
        process.argv.includes('--coverage')
      );
    }
  });
});
