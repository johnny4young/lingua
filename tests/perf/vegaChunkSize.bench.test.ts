/**
 * RL-044 next slice fold B — vega bundle bench guard.
 *
 * `<RichValueChart>` lazy-imports `vega-embed` into a dedicated Vite
 * `vega-embed` manualChunk so charting never weighs on the initial
 * bundle. This guard locks the chunk's gzipped size so a future vega
 * major bump (or an accidental eager import that pulls vega into the
 * chart chunk's graph) cannot silently balloon the lazy budget that
 * `check:performance` tracks in aggregate — this is the per-chunk
 * tripwire that pinpoints vega specifically.
 *
 * Skips when `dist/web` has not been built (the unit-test gate runs
 * before `build:web` in CI; the budget check + this guard run after).
 * Mirrors the skip-when-absent pattern in `tests/cli/integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const ASSETS_DIR = path.resolve(process.cwd(), 'dist', 'web', 'assets');

// Current gzip is ~281 KiB; 330 KiB leaves headroom for patch-level
// vega churn while still catching a major-version balloon (the vega 5→6
// bump this repo just took added ~tens of KiB, not hundreds).
const MAX_VEGA_GZIP_BYTES = 330 * 1024;

function findVegaChunk(): string | null {
  if (!existsSync(ASSETS_DIR)) return null;
  const match = readdirSync(ASSETS_DIR).find(
    (name) => name.startsWith('vega-embed-') && name.endsWith('.js')
  );
  return match ? path.join(ASSETS_DIR, match) : null;
}

describe('vega-embed lazy chunk size guard (RL-044 fold B)', () => {
  const chunkPath = findVegaChunk();

  it.skipIf(chunkPath === null)(
    'keeps the gzipped vega-embed chunk under the budget',
    () => {
      const gzipBytes = gzipSync(readFileSync(chunkPath!)).length;
      expect(
        gzipBytes,
        `vega-embed chunk gzip ${(gzipBytes / 1024).toFixed(1)} KiB exceeds ` +
          `${(MAX_VEGA_GZIP_BYTES / 1024).toFixed(0)} KiB budget`
      ).toBeLessThanOrEqual(MAX_VEGA_GZIP_BYTES);
    }
  );

  it('keeps the gzip budget in a sane band so the guard stays meaningful', () => {
    // Runs regardless of build state (the chunk-size assertion above
    // skips on a clean checkout). This guards the guard: a future dev
    // can't silently neuter the size check by inflating the constant,
    // and can't set it so low it false-fails. Current chunk is
    // ~281 KiB; the band brackets that with headroom on both sides.
    expect(MAX_VEGA_GZIP_BYTES).toBeGreaterThan(256 * 1024);
    expect(MAX_VEGA_GZIP_BYTES).toBeLessThan(512 * 1024);
  });
});
