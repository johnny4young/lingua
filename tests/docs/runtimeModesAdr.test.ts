/**
 * ADR guard for runtime modes.
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
 *   - All five runtime modes are shipped.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/RUNTIME_MODES_ADR.md');

describe('RUNTIME_MODES_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted decision plus a date', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Date\s*\|\s*2026-05-12/u);
    expect(adr).toMatch(/Implementation\s*\|[\s\S]*Deno[\s\S]*Bun/iu);
  });

  it('locks the three-mode enum and their per-change status', () => {
    for (const mode of ['worker', 'node', 'browser-preview']) {
      expect(adr).toContain(`\`${mode}\``);
    }
    expect(adr.match(/\*\*Shipping\*\*/gu)).toHaveLength(5);
  });

  it('records the Node mode ship notes (runner + stop + env allowlist)', () => {
    expect(adr).toMatch(/## Node mode ship notes/u);
    expect(adr).toContain('src/main/node-runner.ts');
    expect(adr).toContain('src/preload/index.ts');
    expect(adr).toContain('src/renderer/runners/nodeRunner.ts');
    expect(adr).toContain('window.lingua.node.stop');
    expect(adr).toContain('NODE_TOOLCHAIN_KEYS');
    expect(adr).toContain('runtime.node_runner_used');
  });

  it('records the Browser Preview ship notes (architecture + postMessage + sandbox + timeout)', () => {
    expect(adr).toMatch(/## Browser Preview ship notes/u);
    // Architecture references
    expect(adr).toContain('src/renderer/runners/browserPreview.ts');
    expect(adr).toContain('src/renderer/components/BrowserPreview/iframeBridge.ts');
    expect(adr).toContain('src/renderer/components/BrowserPreview/BrowserPreviewPanel.tsx');
    expect(adr).toContain('src/renderer/runtime/browserPreviewBridge.ts');
    // Protocol anchors
    expect(adr).toMatch(/postMessage protocol/iu);
    expect(adr).toContain('__lingua');
    expect(adr).toContain('runId');
    // Sandbox + CSP
    expect(adr).toMatch(/sandbox="allow-scripts"/u);
    expect(adr).toMatch(/default-src 'none'/u);
    expect(adr).toMatch(/script-src 'unsafe-inline'/u);
    // Timeout kill
    expect(adr).toMatch(/Timeout kill/iu);
    expect(adr).toMatch(/iframe\.srcdoc = ''/u);
  });

  it('records the CSP posture per runtime mode audit', () => {
    expect(adr).toMatch(/## CSP posture per runtime mode \(audit\)/u);
    // The audit table covers all three modes.
    expect(adr).toContain('`worker`');
    expect(adr).toContain('`node` ');
    expect(adr).toContain('`browser-preview` ');
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
    expect(adr).toMatch(/Post-closeout note/iu);
  });

  it('records the no-silent-fallback rule for unimplemented modes', () => {
    expect(adr).toMatch(/No silent fallback to Worker/iu);
    expect(adr).toMatch(/defensive for future enum additions/iu);
  });

  it('documents the telemetry payload contract verbatim', () => {
    expect(adr).toContain('runtime.mode_changed');
    expect(adr).toMatch(/\{\s*mode,\s*language\s*\}/u);
    expect(adr).toMatch(/closed enum/iu);
  });

  it('cross-references the adjacent docs the runtime model depends on', () => {
    for (const pointer of ['CAPABILITY_MATRIX.md', 'DEBUGGER_ADR.md']) {
      expect(adr).toContain(pointer);
    }
  });

  it('locks Decision 6 — runner dispatch stays language-keyed with runtime overrides', () => {
    // The runner registry contract is the most operationally
    // fragile invariant for Node mode. The
    // ADR's Decision 6 says we keep dispatching by `language` for
    // worker mode while Node extends the registry with a small
    // runtime override map.
    expect(adr).toMatch(/Decision 6|runtime overrides/iu);
    expect(adr).toContain('src/renderer/runners/manager.ts');
  });

  it('keeps the rollback path documented and self-contained', () => {
    expect(adr).toMatch(/## Rollback/u);
    expect(adr).toContain('Revert the Toolbar mount');
    expect(adr).toContain('defensively coerced');
  });
});
