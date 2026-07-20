/**
 * Language-pack design guard — the ADR locks the descriptor
 * shape, the migration history, and the no-marketplace
 * constraint so future implementation detail work proceeds against a written
 * contract instead of reinventing a plugin story.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/LANGUAGE_PACK_ADR.md');

describe('LANGUAGE_PACK_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted design decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/declarative `LanguagePack` descriptor/i);
  });

  it('declares the descriptor fields the internal scope enumerates', () => {
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

  it('enumerates the shipped migration history', () => {
    expect(adr).toContain('Descriptor and built-in metadata');
    expect(adr).toContain('Runner dispatch');
    expect(adr).toMatch(/Capability-aware UI\. Shipped 2026-05-01/i);
    expect(adr).toContain('SnippetsModal');
    expect(adr).toContain('EditorEmptyState');
    expect(adr).toMatch(/no per-language Settings surface today/i);
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
      'internal',
      'internal',
      'internal',
      'internal',
    ]) {
      expect(adr).toContain(pointer);
    }
  });
});
