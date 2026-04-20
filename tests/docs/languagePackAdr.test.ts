/**
 * RL-038 language-pack design guard — the ADR locks the descriptor
 * shape, the three-slice migration plan, and the no-marketplace
 * constraint so future RL-042 / RL-026 work proceeds against a written
 * contract instead of reinventing a plugin story.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../LANGUAGE_PACK_ADR.md');

describe('LANGUAGE_PACK_ADR.md', () => {
  it('exists at the repo root', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted design decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/declarative `LanguagePack` descriptor/i);
  });

  it('declares the descriptor fields the RL-038 scope enumerates', () => {
    for (const field of [
      'labelKey',
      'extensions',
      'monacoLanguage',
      'execution',
      'runnerId',
      'formatter',
      'capabilities',
      'templateIds',
    ]) {
      expect(adr).toContain(field);
    }
  });

  it('enumerates the three-slice migration plan', () => {
    expect(adr).toContain('Slice A');
    expect(adr).toContain('Slice B');
    expect(adr).toContain('Slice C');
  });

  it('calls out the no-marketplace and i18n-parity constraints verbatim', () => {
    expect(adr).toMatch(/No third-party code loading/i);
    expect(adr).toMatch(/i18n parity/i);
  });

  it('cross-links adjacent ADRs and RL items so migrations stay traceable', () => {
    for (const pointer of [
      'CAPABILITY_MATRIX.md',
      'BUILD_SYSTEM_ADR.md',
      'TAURI_SPIKE_ADR.md',
      'RL-042',
      'RL-058',
      'RL-026',
      'RL-027',
    ]) {
      expect(adr).toContain(pointer);
    }
  });
});
