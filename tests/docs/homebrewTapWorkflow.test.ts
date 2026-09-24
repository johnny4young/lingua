/**
 * Guard for `.github/workflows/update-homebrew-tap.yml`: the tap may only move
 * to a published stable release, from its checksums, and never backwards.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(__dirname, '../../.github/workflows/update-homebrew-tap.yml'),
  'utf-8'
);

function step(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return (
    workflow.match(new RegExp(`\\n {6}- name: ${escaped}\\n[\\s\\S]*?(?=\\n {6}- |$)`, 'u'))?.[0] ??
    ''
  );
}

describe('Homebrew tap workflow', () => {
  it('runs on publication, not on the draft the release workflow creates', () => {
    expect(workflow).toMatch(/on:\n {2}release:\n {4}types: \[published\]/u);
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' || !github.event.release.prerelease");
    const validate = step('Validate the release tag');
    expect(validate).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(validate).toContain('if [[ "${state}" != "false false" ]]');
  });

  it('renders both recipes from the published checksums with the tagged generator', () => {
    expect(workflow).toContain('ref: refs/tags/${{ env.RELEASE_TAG }}');
    const render = step('Render recipes from the published checksums');
    expect(render).toContain('gh release download "${RELEASE_TAG}" --pattern SHA256SUMS.txt');
    expect(render).toContain('node scripts/generate-distribution-manifests.mjs');
    expect(render).toContain('--checksums "${RUNNER_TEMP}/SHA256SUMS.txt"');
    expect(render).toContain('ruby -c packaging/homebrew/Casks/lingua.rb packaging/homebrew/Formula/lingua-cli.rb');
  });

  it('pushes only the Lingua recipes, never downgrades, and tolerates a missing key', () => {
    const push = step('Push to the tap');
    expect(push).toContain('TAP_DEPLOY_KEY: ${{ secrets.TAP_DEPLOY_KEY }}');
    expect(push).toContain('exit 0');
    expect(push).toContain('refusing to replace it with');
    expect(push).toContain('sort -V');
    expect(push).toContain('git add Casks/lingua.rb Formula/lingua-cli.rb');
    expect(push).toContain('git push origin HEAD:main');
    expect(push).not.toContain('--force');
  });

  it('keeps the default token read-only and actions pinned to commits', () => {
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n/u);
    for (const uses of workflow.match(/uses: \S+/gu) ?? []) {
      expect(uses).toMatch(/@[0-9a-f]{40}$/u);
    }
  });
});
