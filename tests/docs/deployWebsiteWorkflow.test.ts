/**
 * Guard for `.github/workflows/deploy-website.yml`.
 *
 * The static releases page prefers the GitHub Releases API while Astro
 * prerenders it. The deploy refreshes a trusted snapshot first and may retain
 * the committed copy only when it still passes the repository-version guard.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/deploy-website.yml');

describe('website deploy workflow', () => {
  it('builds every localized route from the release snapshot validated earlier', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);

    const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
    const buildStep =
      workflow.match(/\n {6}- name: Build\n[\s\S]*?(?=\n {6}- name:|$)/u)?.[0] ?? '';

    expect(buildStep).toContain('LINGUA_SOURCE: local');
    expect(buildStep).not.toContain('GITHUB_TOKEN');
    expect(buildStep).toContain('run: npm run build');
  });

  it('refreshes release metadata but fails closed when the fallback snapshot drifts', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
    const refreshStep =
      workflow.match(/\n {6}- name: Refresh trusted release snapshot\n[\s\S]*?(?=\n {6}- name:|$)/u)?.[0] ??
      '';

    expect(refreshStep).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(refreshStep).toContain('if npm run sync:release; then');
    expect(refreshStep).toContain('npm run check:release-snapshot');
    expect(refreshStep).not.toContain('continue-on-error');
  });
});
