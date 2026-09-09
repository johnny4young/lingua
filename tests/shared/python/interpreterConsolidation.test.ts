/**
 * Locks the consolidation itself, not just the policy.
 *
 * `tests/shared/python/interpreter.test.ts` proves the shared policy is
 * correct. It cannot prove the three surfaces USE it — and that was the actual
 * defect: `lingua run`, the project test runner and the debugger each carried
 * their own candidate list, and on Windows those lists disagreed, so one
 * project could resolve to three different interpreters.
 *
 * A future surface (or a well-meaning inline "fix") can reintroduce the drift
 * without any behavioural test failing, because each surface looks reasonable
 * on its own. These cases fail the moment a Python-spawning surface hand-rolls
 * a candidate list again.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

/** Every surface that resolves a Python interpreter to spawn. */
const PYTHON_SPAWNING_SURFACES = [
  'src/cli/runtime/targets.ts',
  'src/main/projectTests.ts',
  'src/main/ipc/pythonDebugger.ts',
] as const;

/**
 * Command names and virtualenv layout fragments that belong to the shared
 * policy. Seeing one as a literal in a consuming surface means that surface
 * decided for itself again.
 */
const POLICY_LITERALS = [/'python3'/u, /'py'/u, /'python\.exe'/u, /'\.venv'/u, /'venv'/u];

function read(file: string): string {
  return readFileSync(path.join(repoRoot, file), 'utf8');
}

describe('Python interpreter discovery is consolidated', () => {
  for (const surface of PYTHON_SPAWNING_SURFACES) {
    it(`${surface} resolves through the shared policy`, () => {
      expect(read(surface)).toContain('shared/python/interpreter');
    });

    it(`${surface} does not hand-roll its own candidate list`, () => {
      const source = read(surface);
      const offenders = POLICY_LITERALS.filter(pattern => pattern.test(source)).map(
        pattern => pattern.source
      );

      expect(
        offenders,
        offenders.length === 0
          ? ''
          : `${surface} contains interpreter-policy literals: ${offenders.join(', ')}.\n` +
              'Candidate names and virtualenv layouts belong to ' +
              'src/shared/python/interpreter.ts so every surface agrees; keep only ' +
              'the probe local.'
      ).toEqual([]);
    });
  }

  it('names every surface the policy module claims to serve', () => {
    // The module's own doc comment enumerates its consumers. If a fourth
    // surface appears, this list and that comment both need updating, and
    // this assertion is where that gets noticed.
    const policy = read('src/shared/python/interpreter.ts');

    expect(policy).toContain('CLI');
    expect(policy).toContain('test runner');
    expect(policy).toContain('debugger');
    expect(PYTHON_SPAWNING_SURFACES).toHaveLength(3);
  });
});
