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
const PACKAGE_JSON_PATH = resolve(__dirname, '../../package.json');

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
  const packageJson = existsSync(PACKAGE_JSON_PATH)
    ? JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { scripts: Record<string, string> }
    : { scripts: {} };

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

  it('runs a release-blocking production audit before any platform build (RL-080 Slice 2)', () => {
    // The `security-audit` job is gated on `prepare-release-tag` and
    // each platform build plus web deploy list it under `needs:` so a
    // failure aborts the release before any runner-minute is spent on
    // platform builds or a web-only deploy. The full dependency graph
    // still prints as advisory output because stable Forge 7 carries
    // dev-only audit findings with no stable upstream fix.
    expect(workflow).toMatch(/security-audit:\s*\n\s*name: Security audit \(release-blocking\)/u);
    expect(workflow).toMatch(
      /Run blocking production npm audit[\s\S]*?npm audit --omit=dev --audit-level=high/u,
    );
    expect(workflow).toMatch(
      /Run advisory full npm audit[\s\S]*?npm audit --audit-level=high[\s\S]*?continue-on-error: true/u,
    );

    // Match either the inline-array form `needs: [prepare-release-tag,
    // security-audit]` or the multi-line YAML form
    //
    //   needs:
    //     - prepare-release-tag
    //     - security-audit
    //
    // so a `prettier` / yamllint reformat that flips the shape does
    // NOT silently drop the audit dep on the build jobs.
    const inlineDeps = workflow.match(/needs:\s*\[\s*prepare-release-tag\s*,\s*security-audit\s*\]/gu) ?? [];
    const multiLineDeps =
      workflow.match(
        /needs:\s*\n\s*-\s*prepare-release-tag\s*\n\s*-\s*security-audit/gu,
      ) ?? [];
    expect(inlineDeps.length + multiLineDeps.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toMatch(/deploy-web:[\s\S]*?needs:\s*\[\s*publish\s*,\s*security-audit\s*\]/u);
    expect(workflow).toContain("needs.security-audit.result == 'success'");
  });

  it('runs a release-blocking packaged desktop smoke after macOS signing (RL-080 Slice 3)', () => {
    // The `Packaged desktop smoke` step is gated on macOS signing
    // verification (so we only smoke a properly-signed bundle) and
    // sits before `Upload macOS artifacts` so a smoke failure aborts
    // the artifact from ever leaving the build runner. Bloqueante:
    // there is NO `continue-on-error: true` on the step.
    expect(workflow).toContain('Packaged desktop smoke');
    expect(workflow).toMatch(/npm run smoke:desktop:packaged/u);
    expect(packageJson.scripts['smoke:desktop:packaged']).toContain('--offline');
    const signingIndex = workflow.indexOf('Verify macOS signing');
    const packagedSmokeIndex = workflow.indexOf('Packaged desktop smoke');
    const uploadIndex = workflow.indexOf('Upload macOS artifacts');
    expect(signingIndex).toBeGreaterThan(0);
    expect(packagedSmokeIndex).toBeGreaterThan(signingIndex);
    expect(uploadIndex).toBeGreaterThan(packagedSmokeIndex);

    // Capture the step's YAML body and assert it does NOT opt out of
    // failure propagation. A future "soft launch" change that adds
    // `continue-on-error: true` would silently turn this gate
    // advisory; the regex catches that regression.
    const stepMatch = workflow.match(
      /- name: Packaged desktop smoke\s*\n([\s\S]*?)(?=\n\s*-\s+name:|$)/u,
    );
    expect(stepMatch, 'Packaged desktop smoke step body not found').not.toBeNull();
    expect(stepMatch![1]).not.toMatch(/continue-on-error:\s*true/u);
  });

  it('re-verifies SHA256SUMS.txt against the downloaded payload before publishing (RL-080 Slice 2)', () => {
    // The `Verify release checksums` step runs after `Generate
    // release checksums` and uses `shasum -a 256 -c SHA256SUMS.txt`
    // so a manifest mismatch (corrupted asset, wrong file order,
    // tampering between generate and publish) aborts the publish.
    expect(workflow).toContain('Verify release checksums');
    expect(workflow).toMatch(/shasum\s+-a\s+256\s+-c\s+SHA256SUMS\.txt/u);
    const generateIndex = workflow.indexOf('Generate release checksums');
    const verifyIndex = workflow.indexOf('Verify release checksums');
    const publishIndex = workflow.indexOf('Publish draft GitHub Release');
    expect(generateIndex).toBeGreaterThan(0);
    expect(verifyIndex).toBeGreaterThan(generateIndex);
    expect(publishIndex).toBeGreaterThan(verifyIndex);
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
