/**
 * RL-035 Tauri spike decision guard — this test fails CI if anyone strips
 * the decision, the analysis, or the when-to-revisit triggers. Protects
 * the "no full migration work starts before a decision" acceptance line.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../TAURI_SPIKE_ADR.md');

describe('TAURI_SPIKE_ADR.md', () => {
  it('exists at the repo root', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted no-go decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Decision\s*\|\s*Do not migrate/i);
  });

  it('enumerates the RL-035 measurement axes so the trade-off is inspectable', () => {
    for (const axis of [
      'Cold start',
      'Bundle size',
      'Update/signing path',
      'Permission model',
      'Maintenance cost of the Rust shell',
      'Impact on Go/Rust runner architecture',
    ]) {
      expect(adr).toContain(axis);
    }
  });

  it('lists the four or more revisit triggers so future migrations have a bar to clear', () => {
    expect(adr).toContain('## When to revisit');
    for (const marker of ['1.', '2.', '3.', '4.', '5.']) {
      expect(adr).toContain(marker);
    }
  });

  it('cross-links BUILD_SYSTEM_ADR and CAPABILITY_MATRIX so the adjacent decisions are traceable', () => {
    expect(adr).toContain('BUILD_SYSTEM_ADR.md');
    expect(adr).toContain('CAPABILITY_MATRIX.md');
    expect(adr).toContain('RL-034');
    expect(adr).toContain('RL-067');
  });
});
