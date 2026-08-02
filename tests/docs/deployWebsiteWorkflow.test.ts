/**
 * Guard for `.github/workflows/deploy-website.yml`.
 *
 * The static releases page prefers the GitHub Releases API while Astro
 * prerenders it. The deploy refreshes a trusted snapshot first and may retain
 * the committed public release while source is ahead. Publishing a release
 * switches the same guard to exact-version mode.
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

  it('allows a prior public snapshot on source pushes but requires the current release on publication', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
    const refreshStep =
      workflow.match(/\n {6}- name: Refresh trusted release snapshot\n[\s\S]*?(?=\n {6}- name:|$)/u)?.[0] ??
      '';

    expect(refreshStep).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(refreshStep).toContain('if [[ "${{ github.event_name }}" == "release" ]]');
    expect(refreshStep).toContain('release_args+=(--require-current)');
    expect(refreshStep).toContain('npm run sync:release -- "${release_args[@]}"');
    expect(refreshStep).toContain('npm run check:release-snapshot -- "${release_args[@]}"');
    expect(refreshStep).not.toContain('continue-on-error');
  });
});
