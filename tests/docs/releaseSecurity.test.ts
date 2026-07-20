/**
 * internal release security checklist guard — keeps the public-release
 * security sign-off tied to Lingua's highest-risk surfaces.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CHECKLIST_PATH = resolve(ROOT, 'docs/RELEASE_SECURITY.md');
const RELEASE_PATH = resolve(ROOT, 'RELEASE.md');

describe('docs/RELEASE_SECURITY.md release security checklist', () => {
  it('exists and is linked from the release checklist', () => {
    expect(existsSync(CHECKLIST_PATH)).toBe(true);
    expect(readFileSync(RELEASE_PATH, 'utf-8')).toContain('docs/RELEASE_SECURITY.md');
  });

  const checklist = existsSync(CHECKLIST_PATH) ? readFileSync(CHECKLIST_PATH, 'utf-8') : '';

  it('keeps the required security review sections', () => {
    for (const heading of [
      '## Electron And Preload',
      '## IPC And Filesystem',
      '## Runners',
      '## Updates And Release Artifacts',
      '## Licensing',
      '## Telemetry And Crash Reporting',
      '## Dependencies And Notices',
      '## Public Documentation Claims',
    ]) {
      expect(checklist).toContain(heading);
    }
  });

  it('mentions the concrete controls release owners must re-check', () => {
    for (const term of [
      'typed, intentional bridge methods',
      'rootId',
      'relativePath',
      'watcher ids are opaque',
      'filtered environment',
      'SHA256SUMS.txt',
      'desktop-update-draft-validation.md',
      'GITHUB_RELEASE_CHANNEL=draft',
      'license tokens',
      'payload redaction',
      'pnpm run check:licenses',
      'lingua-sbom.cyclonedx.json',
    ]) {
      expect(checklist).toContain(term);
    }
  });
});
