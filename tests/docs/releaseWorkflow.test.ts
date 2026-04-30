/**
 * Guard for `.github/workflows/release.yml`.
 *
 * The publish job runs on a Linux runner that downloads pre-built macOS,
 * Windows, and Linux artifacts. Earlier revisions ran `electron-forge
 * publish` here, which only uploads what its own `make` step produces —
 * so the macOS .zip and Windows .exe pulled in by `download-artifact`
 * were dropped on the floor and the draft release came out
 * Linux-only (or just failed when rpm/fakeroot were missing).
 *
 * This test pins the corrected shape: the workflow must download the
 * three platform artifact bundles, generate `SHA256SUMS.txt`, and use
 * the GitHub CLI to publish a draft release with the collected files.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/release.yml');
const DEPLOY_WEB_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/deploy-web.yml');

describe('release workflow', () => {
  it('exists at the expected path', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  const workflow = existsSync(WORKFLOW_PATH)
    ? readFileSync(WORKFLOW_PATH, 'utf-8')
    : '';
  const deployWebWorkflow = existsSync(DEPLOY_WEB_WORKFLOW_PATH)
    ? readFileSync(DEPLOY_WEB_WORKFLOW_PATH, 'utf-8')
    : '';

  it('downloads pre-built artifacts before publishing', () => {
    expect(workflow).toMatch(/uses:\s*actions\/download-artifact@v4/u);
    expect(workflow).toContain('merge-multiple: true');
  });

  it('generates SHA256SUMS.txt before the draft release is created', () => {
    expect(workflow).toContain('SHA256SUMS.txt');
    expect(workflow).toMatch(/shasum\s+-a\s+256/u);
    const checksumIndex = workflow.indexOf('Generate release checksums');
    const publishIndex = workflow.indexOf('Publish draft GitHub Release');
    expect(checksumIndex).toBeGreaterThan(0);
    expect(publishIndex).toBeGreaterThan(checksumIndex);
  });

  it('uses the GitHub CLI to upload the downloaded assets as a draft release', () => {
    // The legacy `electron-forge publish` shape would have re-run `make`
    // on the publish runner and silently dropped the macOS / Windows
    // assets — this guard makes that regression loud.
    expect(workflow).not.toMatch(/npm run publish:desktop/u);
    expect(workflow).toMatch(/gh release create[\s\S]*?--draft/u);
    expect(workflow).toMatch(/gh release upload "\$\{RELEASE_TAG\}"/u);
  });

  it('refuses to clobber an existing published release', () => {
    expect(workflow).toMatch(/gh release view "\$\{RELEASE_TAG\}" --json isDraft --jq \.isDraft/u);
    expect(workflow).toContain('Release ${RELEASE_TAG} already exists and is not a draft');
    expect(workflow).toMatch(/if \[\[ "\$\{release_is_draft\}" != "true" \]\]; then[\s\S]*?exit 1/u);
  });

  it('verifies macOS, Windows, and Linux artifacts before publishing', () => {
    expect(workflow).toContain('Verify macOS artifacts');
    expect(workflow).toContain('Verify Windows artifacts');
    expect(workflow).toContain('Verify Linux artifacts');
  });

  it('publishes only when every selected platform build succeeded', () => {
    expect(workflow).toContain("!inputs.release_macos || needs['build-macos'].result == 'success'");
    expect(workflow).toContain("!inputs.release_windows || needs['build-windows'].result == 'success'");
    expect(workflow).toContain("!inputs.release_linux || needs['build-linux'].result == 'success'");
  });

  it('allows web-only releases without publishing partial desktop failures', () => {
    expect(workflow).toContain('!inputs.release_macos && !inputs.release_windows && !inputs.release_linux');
    expect(workflow).toContain("needs.publish.result == 'success'");
  });

  it('deploys the web bundle from the validated release tag ref', () => {
    expect(existsSync(DEPLOY_WEB_WORKFLOW_PATH)).toBe(true);
    // GitHub Actions rejects `env.*` inside `with:` of a reusable
    // workflow call ("Unrecognized named-value: 'env'"), so the ref
    // is computed inline from inputs.release_tag instead of via
    // env.RELEASE_REF.
    expect(workflow).toMatch(
      /uses:\s*\.\/\.github\/workflows\/deploy-web\.yml[\s\S]*?with:[\s\S]*?ref:\s*refs\/tags\/\$\{\{\s*inputs\.release_tag\s*\}\}/u
    );
    expect(deployWebWorkflow).toMatch(/workflow_call:[\s\S]*?inputs:[\s\S]*?ref:[\s\S]*?default:\s*refs\/heads\/main/u);
    expect(deployWebWorkflow).toMatch(/uses:\s*actions\/checkout@v4[\s\S]*?ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/u);
  });
});
