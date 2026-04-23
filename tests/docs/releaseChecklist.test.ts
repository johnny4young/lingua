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

  const checklist = existsSync(CHECKLIST_PATH)
    ? readFileSync(CHECKLIST_PATH, 'utf-8')
    : '';

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
    ]) {
      expect(checklist).toContain(marker);
    }
  });

  it('requires the packaged desktop smoke before promotion', () => {
    expect(checklist).toContain('npm run smoke:desktop');
    expect(checklist).toContain('output/playwright/desktop-smoke');
  });

  it('requires a post-publish smoke before the announcement', () => {
    expect(checklist).toMatch(/post-publish smoke/i);
    expect(checklist).toMatch(/Do not announce before/i);
  });

  it('ships a validation checklist with signing, checksums, and the smoke gate', () => {
    expect(checklist).toContain('## Validation checklist');
    expect(checklist).toMatch(/macOS signing verification/i);
    expect(checklist).toMatch(/Windows signing verification/i);
    expect(checklist).toContain('SHA256SUMS.txt');
    expect(checklist).toMatch(/smoke:desktop.*passed|passed.*smoke:desktop/i);
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
