import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHECKLIST_PATH = resolve(__dirname, '../../RELEASE.md');

describe('RELEASE.md release checklist', () => {
  it('exists at the repo root', () => {
    expect(existsSync(CHECKLIST_PATH)).toBe(true);
  });

  const checklist = existsSync(CHECKLIST_PATH) ? readFileSync(CHECKLIST_PATH, 'utf8') : '';

  it('keeps the draft-first preflight and rollback gates', () => {
    expect(checklist).toContain('## Preconditions');
    expect(checklist).toContain('pnpm run release:preflight');
    expect(checklist).toContain('## Release steps');
    expect(checklist).toContain('## Validation checklist');
    expect(checklist).toContain('## Rollback plan');
    expect(checklist).toMatch(/remains draft until human review/iu);
  });

  it('uses GitHub Releases as the desktop download and updater source', () => {
    expect(checklist).toMatch(/GitHub Releases.*canonical desktop/iu);
    expect(checklist).toContain('latest-mac.yml');
    expect(checklist).toContain('latest.yml');
    expect(checklist).toContain('latest-linux.yml');
    expect(checklist).not.toContain('check:r2-mirror');
    expect(checklist).not.toContain('check:update-feed');
  });

  it('requires architecture-correct macOS smoke evidence', () => {
    expect(checklist).toContain('macOS arm64 + x64');
    expect(checklist).toMatch(/host-native app/iu);
    expect(checklist).toMatch(/Intel build under Rosetta/iu);
  });

  it('starts Windows support with a validated NSIS installer', () => {
    expect(checklist).toContain('Windows NSIS structure');
    expect(checklist).toContain('win-unpacked/lingua.exe');
    expect(checklist).toContain('resources/app.asar');
    expect(checklist).toContain('resources/app-update.yml');
    expect(checklist).toContain('unsigned preview');
    expect(checklist).toContain('SmartScreen');
    expect(checklist).toContain('Authenticode');
  });

  it('keeps R2 scoped to web runtimes', () => {
    expect(checklist).toContain('R2 web-runtime assets');
    expect(checklist).toContain('pnpm run check:release-infra');
    expect(checklist).toMatch(/R2 owns only.*web runtimes/iu);
  });

  it('requires checksums and compliance evidence', () => {
    expect(checklist).toContain('SHA256SUMS.txt');
    expect(checklist).toContain('lingua-sbom.cyclonedx.json');
    expect(checklist).toContain('THIRD_PARTY_LICENSE_REPORT.md');
  });

  it('requires post-publish platform update smoke before announcement', () => {
    expect(checklist).toMatch(/post-publish smoke/iu);
    expect(checklist).toMatch(/Announce only after/iu);
    expect(checklist).toContain('docs/runbooks/desktop-update-draft-validation.md');
  });

  it('keeps the checklist as the release-process acceptance gate', () => {
    expect(checklist).toContain('acceptance gate');
  });
});
