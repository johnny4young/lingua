import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PREFLIGHT_GATE_SCRIPTS,
  CI_ONLY_GATE_SCRIPTS,
} from '../../scripts/lib/releasePreflightGates.mjs';
import { resolveTag } from '../../scripts/release-preflight.mjs';

/**
 * Anti-drift guard for the release preflight. The whole point of the preflight
 * is that it stays a faithful local mirror of the release-blocking gates the
 * workflows run. This test fails if a gate-shaped script (`check:*`,
 * `changelog:*`, `compliance:*`, `smoke:*`, `build:web`) appears in
 * `release.yml` / `deploy-web.yml` but is neither covered by the preflight nor
 * explicitly marked CI-only — forcing a conscious decision instead of silent
 * drift (which is how the v0.7.0 release shipped two un-previewable gates).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function workflowGateScripts(file: string): string[] {
  const text = readFileSync(path.join(repoRoot, '.github', 'workflows', file), 'utf8');
  const found = new Set<string>();
  // Match `pnpm run <script>` (the form every gate uses in the workflows).
  for (const match of text.matchAll(/pnpm run ([\w:-]+)/gu)) {
    const script = match[1]!;
    if (/^(check:|changelog:|compliance:|smoke:)/u.test(script) || script === 'build:web') {
      found.add(script);
    }
  }
  return [...found];
}

describe('release preflight ↔ workflow parity', () => {
  const classified = new Set<string>([...PREFLIGHT_GATE_SCRIPTS, ...CI_ONLY_GATE_SCRIPTS]);

  it('covers (or explicitly defers) every gate the release workflows run', () => {
    const releaseGates = workflowGateScripts('release.yml');
    const deployGates = workflowGateScripts('deploy-web.yml');
    const allGates = new Set([...releaseGates, ...deployGates]);

    const unclassified = [...allGates].filter((script) => !classified.has(script));
    expect(
      unclassified,
      `These release-gate scripts run in the workflows but are neither in the preflight nor CI_ONLY_GATE_SCRIPTS. Add them to scripts/lib/releasePreflightGates.mjs:\n  ${unclassified.join('\n  ')}`
    ).toEqual([]);
  });

  it('runs the two gates that broke v0.7.0 in the preflight (not deferred)', () => {
    // The license-rotation logic bug and the R2 infra/CORS break must both be
    // catchable locally — that is the entire reason this preflight exists.
    expect(PREFLIGHT_GATE_SCRIPTS).toContain('check:license-rotation');
    expect(PREFLIGHT_GATE_SCRIPTS).toContain('check:release-infra');
  });

  it('does not classify the same script as both preflight and CI-only', () => {
    const overlap = PREFLIGHT_GATE_SCRIPTS.filter((script) => CI_ONLY_GATE_SCRIPTS.includes(script));
    expect(overlap).toEqual([]);
  });

  it('resolveTag normalizes to a vX.Y.Z tag', () => {
    expect(resolveTag('v0.7.0', '0.6.0')).toBe('v0.7.0');
    expect(resolveTag('0.7.0', '0.6.0')).toBe('v0.7.0');
    expect(resolveTag(undefined, '0.7.0')).toBe('v0.7.0');
  });
});
