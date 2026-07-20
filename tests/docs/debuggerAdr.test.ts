/**
 * internal Debugger MVP ADR guard — locks the decision, the runtime
 * matrix, the feature budget, the rollback clause, the revisit
 * triggers, and the adjacent ADR cross-links.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/DEBUGGER_ADR.md');

describe('DEBUGGER_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted design decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Decision\s*\|\s*Ship a focused debugger MVP/i);
  });

  it('names the four target runtimes in the order they ship', () => {
    expect(adr).toMatch(/JavaScript \/ TypeScript/);
    expect(adr).toMatch(/Python/);
    expect(adr).toMatch(/Go/);
    expect(adr).toMatch(/Rust/);
    const jsIndex = adr.indexOf('JavaScript / TypeScript');
    const pythonIndex = adr.indexOf('Python');
    const goIndex = adr.indexOf('| Go |');
    const rustIndex = adr.indexOf('| Rust |');
    expect(jsIndex).toBeLessThan(pythonIndex);
    expect(pythonIndex).toBeLessThan(goIndex);
    expect(goIndex).toBeLessThan(rustIndex);
  });

  it('pins the feature budget including breakpoints, stepping, watch, stack, and variables', () => {
    expect(adr).toMatch(/Breakpoints/);
    expect(adr).toMatch(/Step over \/ into \/ out \/ continue/);
    expect(adr).toMatch(/Watch expressions/);
    expect(adr).toMatch(/Call stack view/);
    expect(adr).toMatch(/Variable inspection/);
  });

  it('lists explicit out-of-scope items so the MVP stays bounded', () => {
    expect(adr).toMatch(/Out of scope/);
    expect(adr).toMatch(/Time-travel/i);
    expect(adr).toMatch(/Logpoints/i);
    expect(adr).toMatch(/Edit-and-continue/i);
  });

  it('covers source-map, env-var, loop-protection, and telemetry interactions', () => {
    expect(adr).toMatch(/Source maps/);
    expect(adr).toMatch(/Env vars/);
    expect(adr).toMatch(/Loop protection/);
    expect(adr).toMatch(/Telemetry/);
    expect(adr).toMatch(/debugger\.attached/);
    expect(adr).toMatch(/debugger\.paused/);
  });

  it('ships a rollback clause and five revisit triggers', () => {
    expect(adr).toContain('## Rollback');
    expect(adr).toContain('## When to revisit');
    for (const marker of ['1.', '2.', '3.', '4.', '5.']) {
      expect(adr).toContain(marker);
    }
  });

  it('cross-links the adjacent ADRs', () => {
    expect(adr).toContain('BUILD_SYSTEM_ADR.md');
    expect(adr).toContain('LANGUAGE_PACK_ADR.md');
    expect(adr).toContain('CAPABILITY_MATRIX.md');
    expect(adr).toContain('ENV_VARS_ADR.md');
    expect(adr).toContain('internal');
    expect(adr).toContain('internal');
    expect(adr).toContain('internal');
  });
});
