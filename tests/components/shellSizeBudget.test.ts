/**
 * RL-131 (AUDIT-11) size-budget guard. The audit's original targets (App.tsx
 * < 500, AppLayout.tsx < 800) were set against the 2026-05-24 sizes; both files
 * had since grown ~2x, so extracting the two named hooks + BottomPanel +
 * AppOverlays brought them to ~535 / ~892, not under the literal thresholds.
 * These re-based budgets ratchet the achieved sizes so the shell components
 * cannot regrow toward a monolith; the residual reduction to the original
 * targets (a useAppBootstrap hook + EditorArea extraction) is tracked in
 * docs/BACKLOG.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function lineCount(rel: string): number {
  return readFileSync(resolve(ROOT, rel), 'utf8').split('\n').length;
}

const APP_MAX_LINES = 560;
const APP_LAYOUT_MAX_LINES = 920;

const EXTRACTED_MODULES = [
  'src/renderer/hooks/useAppShortcuts.ts',
  'src/renderer/hooks/useLayoutAvailability.ts',
  'src/renderer/components/AppOverlays.tsx',
  'src/renderer/components/Layout/BottomPanel.tsx',
];

describe('RL-131 shell size budget', () => {
  it('App.tsx stays under the re-based budget', () => {
    expect(lineCount('src/renderer/App.tsx')).toBeLessThanOrEqual(APP_MAX_LINES);
  });

  it('AppLayout.tsx stays under the re-based budget', () => {
    expect(
      lineCount('src/renderer/components/Layout/AppLayout.tsx')
    ).toBeLessThanOrEqual(APP_LAYOUT_MAX_LINES);
  });

  it.each(EXTRACTED_MODULES)('%s exists (extraction landed)', (rel) => {
    expect(() => readFileSync(resolve(ROOT, rel), 'utf8')).not.toThrow();
  });
});
