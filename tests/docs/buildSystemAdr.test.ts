/**
 * RL-034 ADR guard — the desktop build-system decision is a P1 doc that
 * blocks RL-033 (Vite-major upgrade) and RL-035 (Tauri spike) from
 * drifting into undocumented migrations. This test fails CI if anyone
 * strips the decision, the scoring matrix, or the when-to-revisit
 * triggers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../BUILD_SYSTEM_ADR.md');

describe('BUILD_SYSTEM_ADR.md', () => {
  it('exists at the repo root', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Decision\s*\|\s*Stay on Electron Forge/i);
  });

  it('scores the three options on every axis the RL-034 scope names', () => {
    for (const axis of [
      'Vite-major agility',
      'Packaging + signing',
      'Update ecosystem',
      'CI portability',
      'Ecosystem maturity',
      'Migration effort',
    ]) {
      expect(adr).toContain(axis);
    }
  });

  it('keeps the three compared options present', () => {
    for (const option of ['Electron Forge', 'electron-vite', 'electron-builder']) {
      expect(adr).toContain(option);
    }
  });

  it('has a when-to-revisit section with at least four triggers', () => {
    expect(adr).toContain('## When to revisit');
    // Each numbered trigger starts with `1.`, `2.`, `3.`, `4.`
    for (const marker of ['1.', '2.', '3.', '4.']) {
      expect(adr).toContain(marker);
    }
  });

  it('cross-links RL-033 and RL-035 so adjacent items stay findable', () => {
    expect(adr).toContain('RL-033');
    expect(adr).toContain('RL-035');
  });
});
