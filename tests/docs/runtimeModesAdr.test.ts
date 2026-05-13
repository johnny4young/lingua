/**
 * RL-019 Slice 1 fold F — ADR guard for runtime modes.
 *
 * Pins the load-bearing decisions in `docs/RUNTIME_MODES_ADR.md` so
 * a future revert that softens any of the contract surfaces fails
 * CI before it ships:
 *   - The three-mode enum (`worker`, `node`, `browser-preview`).
 *   - JS/TS-only scope today.
 *   - `worker` is the default.
 *   - Disabled-with-tooltip vs. hidden (decision 3).
 *   - No silent fallback to worker on unimplemented mode writes.
 *   - Telemetry payload contract.
 *   - Slice 1 ships only `worker`; Slice 2 wires Node; Slice 3
 *     wires Browser preview.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/RUNTIME_MODES_ADR.md');

describe('RUNTIME_MODES_ADR.md (RL-019 Slice 1 fold F)', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted decision plus a date', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Date\s*\|\s*2026-05-12/u);
    expect(adr).toMatch(/Slice\s*\|\s*1 of 3/iu);
  });

  it('locks the three-mode enum and their per-slice status', () => {
    for (const mode of ['worker', 'node', 'browser-preview']) {
      expect(adr).toContain(`\`${mode}\``);
    }
    expect(adr).toMatch(/\*\*Shipping\*\*/u);
    expect(adr).toMatch(/Planned \(Slice 2\)/u);
    expect(adr).toMatch(/Planned \(Slice 3\)/u);
  });

  it('records the JS/TS-only scope and the helper used to gate it', () => {
    expect(adr).toMatch(/JS\/TS only/iu);
    expect(adr).toContain('languageHasRuntimeModes');
  });

  it('locks Worker as the default with three-layer enforcement', () => {
    expect(adr).toMatch(/Worker stays the default/iu);
    expect(adr).toContain('defaultRuntimeModeFor');
    expect(adr).toContain('coerceRuntimeMode');
  });

  it('chooses disabled-with-tooltip over hide-entirely (decision 3)', () => {
    expect(adr).toMatch(/Disabled-with-tooltip vs hidden/iu);
    expect(adr).toMatch(/option \(b\)/iu);
  });

  it('records the no-silent-fallback rule for unimplemented modes', () => {
    expect(adr).toMatch(/No silent fallback to Worker/iu);
    expect(adr).toContain('runtimeMode.notice.notImplementedNode');
    expect(adr).toContain('runtimeMode.notice.notImplementedBrowserPreview');
  });

  it('documents the telemetry payload contract verbatim', () => {
    expect(adr).toContain('runtime.mode_changed');
    expect(adr).toMatch(/\{\s*mode,\s*language\s*\}/u);
    expect(adr).toMatch(/closed enum/iu);
  });

  it('cross-references the adjacent docs the slice depends on', () => {
    for (const pointer of [
      'PLAN.md',
      'CAPABILITY_MATRIX.md',
      'ROADMAP.md',
      'SPRINT-PLAN.md',
      'DEBUGGER_ADR.md',
    ]) {
      expect(adr).toContain(pointer);
    }
  });

  it('locks Decision 6 — runner dispatch stays language-keyed in Slice 1', () => {
    // The runner registry contract is the most operationally
    // fragile invariant for Slice 2 (which adds a NodeRunner). The
    // ADR's Decision 6 says we keep dispatching by `language` for
    // Slice 1 and let Slice 2 extend the registry. A future change
    // that introduces a per-runtime registry would silently
    // contradict the ADR — pin both anchors.
    expect(adr).toMatch(/Decision 6|Runner dispatch stays language-keyed/iu);
    expect(adr).toContain('src/renderer/runners/manager.ts');
  });

  it('keeps the rollback path documented and self-contained', () => {
    expect(adr).toMatch(/## Rollback/u);
    expect(adr).toContain('git revert');
  });
});
