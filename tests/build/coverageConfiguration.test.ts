import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.mts';

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

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
    expect(config.test?.exclude).not.toContain('**/*.bench.test.ts');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('passes the benchmark glob literally rather than expanding shell matches', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'lingua-coverage-argv-'));
    try {
      for (const folder of ['one', 'two']) {
        mkdirSync(join(cwd, folder));
        writeFileSync(join(cwd, folder, 'sample.bench.test.ts'), '');
      }
      const capture = join(cwd, 'capture.mjs');
      writeFileSync(capture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
      // Exercise the actual package-script shell syntax, replacing only the
      // Vitest executable with an argv recorder. Both POSIX sh and Windows cmd
      // must forward a single glob to Vitest, even when the shell has matches.
      const coverageCommand = pkg.scripts['test:coverage'];
      if (!coverageCommand) throw new Error('Missing test:coverage script');
      const command = coverageCommand.replace(
        /^vitest\b/,
        `"${process.execPath}" "${capture}"`
      );
      const output = execFileSync(command, {
        cwd,
        shell: process.platform === 'win32' ? true : '/bin/sh',
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(JSON.parse(output)).toEqual(['run', '--coverage', '--exclude', '**/*.bench.test.ts']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
