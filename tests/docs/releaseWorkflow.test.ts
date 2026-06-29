/**
 * Guard for `.github/workflows/release.yml`.
 *
 * The publish job runs on a Linux runner that downloads pre-built macOS,
 * Windows, and Linux artifacts produced by electron-builder, then uploads them
 * — together with the electron-updater `latest*.yml` feed manifests — to a
 * draft GitHub Release. This test pins that shape so a regression cannot
 * silently drop a platform, omit the update feed, or reintroduce the retired
 * Cloudflare R2 mirror / Electron Forge makers.
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

  const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf-8') : '';
  const deployWebWorkflow = existsSync(DEPLOY_WEB_WORKFLOW_PATH)
    ? readFileSync(DEPLOY_WEB_WORKFLOW_PATH, 'utf-8')
    : '';
  const packageJson = existsSync(PACKAGE_JSON_PATH)
    ? (JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      })
    : { scripts: {}, devDependencies: {} };

  it('builds each platform with electron-builder (not Electron Forge makers)', () => {
    expect(workflow).toMatch(/npx electron-builder --mac/u);
    expect(workflow).toMatch(/npx electron-builder --win/u);
    expect(workflow).toMatch(/npx electron-builder --linux/u);
    expect(workflow).toContain('pnpm run build:desktop-bundles');
    // The Forge maker/publish path is retired.
    expect(workflow).not.toContain('electron-forge');
    expect(workflow).not.toContain('make:desktop');
  });

  it('downloads pre-built artifacts before publishing', () => {
    expect(workflow).toMatch(/uses:\s*actions\/download-artifact@[0-9a-f]{40}/u);
    expect(workflow).toContain('merge-multiple: true');
  });

  it('publishes the electron-updater feed manifests to the release', () => {
    // electron-updater reads latest*.yml from the GitHub Release to auto-update.
    // The publish job must verify one is present and upload it.
    expect(workflow).toContain('latest*.yml');
    expect(workflow).toContain(
      'No electron-updater latest*.yml feed manifest found in the payload'
    );
  });

  it('generates SHA256SUMS.txt before the draft release is created', () => {
    expect(workflow).toContain('SHA256SUMS.txt');
    expect(workflow).toContain('shasum -a 256');
    const checksumIndex = workflow.indexOf('Generate release checksums');
    const publishIndex = workflow.indexOf('Publish draft GitHub Release');
    expect(checksumIndex).toBeGreaterThan(0);
    expect(publishIndex).toBeGreaterThan(checksumIndex);
  });

  it('uses the GitHub CLI to upload the downloaded assets as a draft release', () => {
    expect(workflow).not.toMatch(/(^|\s)npm run publish:desktop/u);
    expect(workflow).toMatch(/gh release create[\s\S]*?--draft/u);
    expect(workflow).toMatch(/gh release upload "\$\{RELEASE_TAG\}"/u);
  });

  it('refuses to clobber an existing published release', () => {
    expect(workflow).toMatch(/gh release view "\$\{RELEASE_TAG\}" --json isDraft --jq \.isDraft/u);
    expect(workflow).toContain('Release ${RELEASE_TAG} already exists and is not a draft');
    expect(workflow).toMatch(
      /if \[\[ "\$\{release_is_draft\}" != "true" \]\]; then[\s\S]*?exit 1/u
    );
  });

  it('verifies macOS, Windows, and Linux artifacts before publishing', () => {
    expect(workflow).toContain('Verify macOS artifacts');
    expect(workflow).toContain('Verify Windows artifacts');
    expect(workflow).toContain('Verify Linux artifacts');
  });

  it('no longer mirrors release artifacts to Cloudflare R2', () => {
    expect(workflow).not.toContain('mirror-r2');
    expect(workflow).not.toContain('infra-readiness');
    expect(workflow).not.toContain('R2_ACCESS_KEY_ID');
    expect(workflow).not.toContain('aws s3 cp');
  });

  it('publishes only when every selected platform build succeeded', () => {
    expect(workflow).toContain("!inputs.release_macos || needs['build-macos'].result == 'success'");
    expect(workflow).toContain(
      "!inputs.release_windows || needs['build-windows'].result == 'success'"
    );
    expect(workflow).toContain("!inputs.release_linux || needs['build-linux'].result == 'success'");
  });

  it('allows web-only releases without publishing partial desktop failures', () => {
    expect(workflow).toContain(
      '!inputs.release_macos && !inputs.release_windows && !inputs.release_linux'
    );
    expect(workflow).toContain("needs.publish.result == 'success'");
  });

  it('runs a release-blocking production audit before any platform build', () => {
    expect(workflow).toMatch(/security-audit:\s*\n\s*name: Security audit \(release-blocking\)/u);
    expect(workflow).toMatch(/Run blocking production audit[\s\S]*?pnpm run check:prod-audit/u);
    expect(workflow).toMatch(
      /Run advisory full audit[\s\S]*?pnpm audit --audit-level high[\s\S]*?continue-on-error: true/u
    );
    expect(workflow).toMatch(
      /Check changelog and release version[\s\S]*?pnpm run changelog:check -- --release-tag "\$\{RELEASE_TAG\}" --from "\$\{RELEASE_TAG\}"/u
    );

    // Every platform build depends on security-audit so a failure aborts the
    // release before any platform runner-minute is spent.
    const inlineDeps =
      workflow.match(/needs:\s*\[\s*prepare-release-tag\s*,\s*security-audit\b[^\]]*\]/gu) ?? [];
    const multiLineDeps =
      workflow.match(/needs:\s*\n\s*-\s*prepare-release-tag\s*\n\s*-\s*security-audit/gu) ?? [];
    expect(inlineDeps.length + multiLineDeps.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toMatch(/deploy-web:[\s\S]*?needs:\s*\[\s*publish\s*,\s*security-audit\s*\]/u);
    expect(workflow).toContain("needs.security-audit.result == 'success'");
  });

  it('runs a release-blocking packaged desktop smoke before uploading the macOS artifact', () => {
    // The packaged smoke proves the produced app boots + runs offline; it sits
    // after the build/sign step and before the artifact upload, with no
    // continue-on-error opt-out, so a failure aborts the release.
    expect(workflow).toContain('Packaged desktop smoke');
    expect(workflow).toMatch(/pnpm run smoke:desktop:packaged/u);
    expect(packageJson.scripts['smoke:desktop:packaged']).toContain('--offline');
    const buildIndex = workflow.indexOf('Build and sign macOS installers');
    const packagedSmokeIndex = workflow.indexOf('Packaged desktop smoke');
    const uploadIndex = workflow.indexOf('Upload macOS artifacts');
    expect(buildIndex).toBeGreaterThan(0);
    expect(packagedSmokeIndex).toBeGreaterThan(buildIndex);
    expect(uploadIndex).toBeGreaterThan(packagedSmokeIndex);

    const stepMatch = workflow.match(
      /- name: Packaged desktop smoke\s*\n([\s\S]*?)(?=\n\s*-\s+name:|$)/u
    );
    expect(stepMatch, 'Packaged desktop smoke step body not found').not.toBeNull();
    expect(stepMatch![1]).not.toMatch(/continue-on-error:\s*true/u);
  });

  it('deploys the web bundle from the validated release tag ref', () => {
    expect(existsSync(DEPLOY_WEB_WORKFLOW_PATH)).toBe(true);
    expect(workflow).toMatch(
      /uses:\s*\.\/\.github\/workflows\/deploy-web\.yml[\s\S]*?with:[\s\S]*?ref:\s*refs\/tags\/\$\{\{\s*inputs\.release_tag\s*\}\}/u
    );
    expect(deployWebWorkflow).toMatch(
      /workflow_call:[\s\S]*?inputs:[\s\S]*?ref:[\s\S]*?default:\s*refs\/heads\/main/u
    );
    expect(deployWebWorkflow).toMatch(
      /uses:\s*actions\/checkout@[0-9a-f]{40}[^\n]*[\s\S]*?ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/u
    );
  });
});
