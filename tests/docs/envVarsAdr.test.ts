/**
 * ADR guard — pins the three scoping decisions (which runtimes
 * accept env vars, web mode answer, scope precedence) so the
 * implementation steps can't ship against the wrong policy.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/ENV_VARS_ADR.md');

describe('ENV_VARS_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted decision plus a date', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Date\s*\|\s*2026-04-20/u);
  });

  it('answers the three internal scoping questions', () => {
    expect(adr).toMatch(/## Decisions/u);
    // Q1: runtimes
    expect(adr).toMatch(/### 1\. Runtimes that receive env vars/iu);
    for (const runtime of ['Go', 'Rust', 'Python', 'JavaScript Worker', 'TypeScript Worker']) {
      expect(adr).toContain(runtime);
    }
    // Q2: web
    expect(adr).toMatch(/### 2\. Web mode/iu);
    expect(adr).toMatch(/No env vars in web mode/iu);
    // Q3: scope precedence
    expect(adr).toMatch(/### 3\. Scope: tab > project > global/u);
    expect(adr).toMatch(/Tab keys override project, project keys override global/u);
  });

  it('blocks the secret-storage scope creep explicitly', () => {
    expect(adr).toMatch(/No secret-storage UI/iu);
    expect(adr).toMatch(/Lingua is a scratchpad, not a vault/u);
  });

  it('lists the implemented runtime and settings surfaces', () => {
    for (const heading of ['Pure scope merger', 'Settings, project, and tab plumbing', 'Settings UI', 'Honest web-mode limit']) {
      expect(adr).toContain(heading);
    }
  });

  it('cross-links the adjacent ADRs and RL items', () => {
    for (const pointer of [
      'BUILD_SYSTEM_ADR.md',
      'CAPABILITY_MATRIX.md',
      'LANGUAGE_PACK_ADR.md',
      'internal',
      'internal',
    ]) {
      expect(adr).toContain(pointer);
    }
  });
});
