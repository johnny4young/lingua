/**
 * Guard for `.github/workflows/ci.yml`.
 *
 * Windows filesystem protection is security-sensitive and cannot rely only on
 * `it.runIf(process.platform === 'win32')` in the regular Ubuntu test job.
 * Keep a dedicated Windows CI job so the platform-specific assertions run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/ci.yml');

describe('CI workflow', () => {
  it('exists at the expected path', () => {
    expect(existsSync(CI_WORKFLOW_PATH)).toBe(true);
  });

  const workflow = existsSync(CI_WORKFLOW_PATH)
    ? readFileSync(CI_WORKFLOW_PATH, 'utf-8')
    : '';

  it('runs Windows path-hardening coverage on a Windows runner', () => {
    expect(workflow).toContain('windows-path-hardening:');
    expect(workflow).toMatch(/windows-path-hardening:[\s\S]*?runs-on:\s*windows-latest/u);
    expect(workflow).toMatch(
      /windows-path-hardening:[\s\S]*?pnpm exec vitest run tests\/ipc\/permissions\.test\.ts/u
    );
  });

  it('runs the performance budget check after the web build report', () => {
    const buildIndex = workflow.indexOf('pnpm run build:web');
    const reportIndex = workflow.indexOf('pnpm run performance:report');
    const checkIndex = workflow.indexOf('pnpm run check:performance');

    expect(buildIndex).toBeGreaterThan(-1);
    expect(reportIndex).toBeGreaterThan(buildIndex);
    expect(checkIndex).toBeGreaterThan(reportIndex);
  });

  it('runs the changelog guard before the test suite', () => {
    const i18nCopyIndex = workflow.indexOf('pnpm run check:i18n:copy');
    const changelogIndex = workflow.indexOf('pnpm run changelog:check');
    const testsIndex = workflow.indexOf('pnpm test');

    expect(i18nCopyIndex).toBeGreaterThan(-1);
    expect(changelogIndex).toBeGreaterThan(i18nCopyIndex);
    expect(testsIndex).toBeGreaterThan(changelogIndex);
  });
});
