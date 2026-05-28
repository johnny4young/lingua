/**
 * RL-016 release checklist guard — fails CI if anyone strips the release
 * steps, the validation gates, or the rollback plan. Keeps the human
 * procedure in sync with the automation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHECKLIST_PATH = resolve(__dirname, '../../RELEASE.md');

describe('RELEASE.md release checklist (RL-016)', () => {
  it('exists at the repo root', () => {
    expect(existsSync(CHECKLIST_PATH)).toBe(true);
  });

  const checklist = existsSync(CHECKLIST_PATH) ? readFileSync(CHECKLIST_PATH, 'utf-8') : '';

  it('documents the preconditions gate', () => {
    expect(checklist).toContain('## Preconditions');
    expect(checklist).toContain('CI is green on `main`');
    expect(checklist).toMatch(/version.*CHANGELOG/i);
  });

  it('ships every numbered release step', () => {
    expect(checklist).toContain('## Release steps');
    for (const marker of [
      '1.',
      '2.',
      '3.',
      '4.',
      '5.',
      '6.',
      '7.',
      '8.',
      '9.',
      '10.',
      '11.',
      '12.',
      '13.',
      '14.',
      '15.',
      // RL-016 follow-up — R2 release mirror sync added the 16th step
      // (private repo means GitHub Releases assets cannot be public-
      // downloaded; mirror-r2 keeps `downloads.linguacode.dev` in sync
      // for marketing-site CTAs). See `docs/runbooks/r2-release-mirror-setup.md`.
      '16.',
    ]) {
      expect(checklist).toContain(marker);
    }
  });

  it('requires the packaged desktop smoke before promotion', () => {
    // Pre-RL-080-Slice-3 the gate was "the human runs npm run
    // smoke:desktop against the downloaded .app". Slice 3 promoted
    // that into the `Packaged desktop smoke` CI step (release-blocking
    // offline, 2-runtime-case subset plus no-CDN assertion). The
    // checklist still names the local smoke as a sanity option and
    // still references the artifact directory for the optional local
    // run, but the primary gate is now the CI step visible in the
    // workflow summary.
    expect(checklist).toContain('npm run smoke:desktop');
    expect(checklist).toContain('output/playwright/desktop-smoke');
    expect(checklist).toMatch(/Packaged desktop smoke/u);
    expect(checklist).toMatch(/release-blocking[^\n]*offline|offline[^\n]*release-blocking/iu);
    expect(checklist).toMatch(/no-CDN assertion|no-cdn assertion/iu);
  });

  it('requires a post-publish smoke before the announcement', () => {
    expect(checklist).toMatch(/post-publish smoke/i);
    expect(checklist).toMatch(/Do not announce before/i);
  });

  it('requires desktop update feed validation before macOS or Windows promotion', () => {
    expect(checklist).toContain('docs/runbooks/desktop-update-draft-validation.md');
    expect(checklist).toContain('npm run check:update-feed');
    expect(checklist).toContain('output/update-feed-validation/update-feed-validation.json');
  });

  it('ships a validation checklist with signing, checksums, and the smoke gate', () => {
    expect(checklist).toContain('## Validation checklist');
    expect(checklist).toContain('docs/RELEASE_SECURITY.md');
    expect(checklist).toMatch(/macOS signing verification/i);
    expect(checklist).toMatch(/Windows signing verification/i);
    expect(checklist).toContain('SHA256SUMS.txt');
    expect(checklist).toMatch(/smoke:desktop.*passed|passed.*smoke:desktop/i);
  });

  it('requires the RL-080 Slice 2 release-blocking audit + checksum re-verify gates', () => {
    // RL-080 Slice 2 — the release pipeline runs a blocking
    // production dependency audit and re-runs `shasum -a 256 -c`
    // against the downloaded payload after the manifest is generated.
    // The full dependency audit remains advisory because the stable
    // Electron Forge 7 build toolchain still carries dev-only audit
    // findings with no stable upstream fix. Both release gates must
    // remain in the validation checklist so the human procedure stays
    // in lockstep with `release.yml`.
    expect(checklist).toMatch(/release-blocking.*pnpm audit|pnpm audit.*release-blocking/i);
    expect(checklist).toContain('pnpm audit --prod --audit-level high');
    expect(checklist).toMatch(/shasum\s+-a\s+256\s+-c\s+SHA256SUMS\.txt/u);
  });

  it('requires the RL-085 release compliance artifacts', () => {
    expect(checklist).toContain('npm run check:licenses');
    expect(checklist).toContain('npm run compliance:release');
    expect(checklist).toContain('lingua-sbom.cyclonedx.json');
    expect(checklist).toContain('THIRD_PARTY_LICENSE_REPORT.md');
  });

  it('links desktop signing setup and changelog/performance readiness gates', () => {
    expect(checklist).toContain('docs/MACOS_SIGNING.md');
    expect(checklist).toContain('docs/WINDOWS_SIGNING.md');
    expect(checklist).toContain('npm run changelog:draft');
    expect(checklist).toContain('npm run changelog:check');
    expect(checklist).toContain('npm run check:performance');
    expect(checklist).toMatch(/version.*CHANGELOG/i);
  });

  it('requires Cloudflare deploy validation evidence for web releases', () => {
    expect(checklist).toContain('cloudflare-deploy-validation');
    expect(checklist).toContain('Wrangler deploy log');
    expect(checklist).toContain('app.linguacode.dev');
    expect(checklist).toContain('updates.linguacode.dev/web/version');
    expect(checklist).toMatch(/service-worker.*update-endpoint bypass/i);
  });

  it('requires Linux package validation evidence before Linux release promotion', () => {
    expect(checklist).toContain('linux-package-validation');
    expect(checklist).toContain('Debian metadata');
    expect(checklist).toContain('RPM metadata');
    expect(checklist).toContain('Debian install');
    expect(checklist).toContain('packaged launch smoke');
    expect(checklist).toContain('uninstall verification');
  });

  it('requires R2 release mirror parity check for marketing-site download CTAs', () => {
    // Source repo is private — GitHub Releases assets are not public-
    // downloadable. The `mirror-r2` job copies them to a Cloudflare R2
    // bucket served at `downloads.linguacode.dev`, and the marketing
    // site in the separate `lingua-marketing` repo links there. The
    // checklist must keep both the per-release validation step + the
    // setup runbook reference so a future contributor cannot drop the
    // public download surface silently.
    expect(checklist).toContain('R2 release mirror');
    expect(checklist).toContain('npm run check:r2-mirror');
    expect(checklist).toContain('output/r2-mirror-validation');
    expect(checklist).toContain('docs/runbooks/r2-release-mirror-setup.md');
    expect(checklist).toContain('R2_ACCESS_KEY_ID');
    expect(checklist).toContain('R2_PUBLIC_BASE');
    expect(checklist).toContain('r2-mirror-validation');
    expect(checklist).toMatch(/lingua-marketing|downloads\.linguacode\.dev/u);
  });

  it('ships a rollback plan that keeps the release in draft on failure', () => {
    expect(checklist).toContain('## Rollback plan');
    expect(checklist).toMatch(/draft/i);
    expect(checklist).toMatch(/hotfix/i);
  });

  it('names RL-016 as the owning plan item so the acceptance gate is traceable', () => {
    expect(checklist).toContain('RL-016');
  });
});
