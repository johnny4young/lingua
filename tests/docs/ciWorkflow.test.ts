/**
 * Guard for `.github/workflows/ci.yml`.
 *
 * Windows filesystem protection and executable launching cannot rely only on
 * platform-skipped tests in the regular Ubuntu job. Keep a dedicated Windows
 * CI job so the platform-specific assertions run against Node on win32.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/ci.yml');

describe('CI workflow', () => {
  it('exists at the expected path', () => {
    expect(existsSync(CI_WORKFLOW_PATH)).toBe(true);
  });

  const workflow = existsSync(CI_WORKFLOW_PATH) ? readFileSync(CI_WORKFLOW_PATH, 'utf-8') : '';

  it('runs Windows platform-boundary coverage on a Windows runner', () => {
    expect(workflow).toContain('windows-path-hardening:');
    expect(workflow).toMatch(/windows-path-hardening:[\s\S]*?runs-on:\s*windows-latest/u);
    expect(workflow).toMatch(
      /windows-path-hardening:[\s\S]*?pnpm exec vitest run[\s\S]*?tests\/ipc\/permissions\.test\.ts/u
    );
    expect(workflow).toMatch(
      /windows-path-hardening:[\s\S]*?tests\/main\/dependencies\.install\.windows\.test\.ts/u
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

  it("uses pnpm audit's supported advisory threshold option", () => {
    expect(workflow).toContain('pnpm audit --audit-level high');
    expect(workflow).not.toContain('pnpm audit --internal');
  });

  it('blocks production advisories in every independently locked package', () => {
    expect(workflow).toContain('pnpm --dir license-server audit --prod --audit-level high');
    expect(workflow).toContain('pnpm --dir update-server audit --prod --audit-level high');
    expect(workflow).toContain(
      'npm --prefix website audit --package-lock-only --omit=dev --audit-level=high'
    );
  });
});
