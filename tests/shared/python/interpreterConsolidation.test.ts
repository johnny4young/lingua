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

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

const POLICY_MODULE = 'src/shared/python/interpreter.ts';

/**
 * A virtualenv interpreter layout — what discovery code must know and what
 * incidental Python references do not.
 */
const VENV_LAYOUT = /\.venv|venv[\\/](?:bin|Scripts)/u;

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

function sourceFilesUnderSrc(): string[] {
  const found: string[] = [];
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(path.relative(repoRoot, child).split(path.sep).join('/'));
    }
  };
  visit(path.join(repoRoot, 'src'));
  return found.sort();
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

  it('catches a fourth surface hand-rolling its own discovery, wherever it lands', () => {
    // Comparing the allowlist above against its own length proves nothing: a
    // new Python launcher added elsewhere would leave the constant at three
    // and every assertion would still pass. This one does not consult the
    // allowlist at all.
    //
    // The signal is a virtualenv interpreter layout. Code that RESOLVES a
    // Python interpreter has to know where a venv puts one; code that merely
    // mentions Python — file extensions, kernel names, dependency detection —
    // does not. A consolidated surface has no such literal, which is exactly
    // why the set below must stay empty rather than match the allowlist:
    // getting consolidated is what removes a file from it.
    const handRolled = sourceFilesUnderSrc()
      .filter(file => file !== POLICY_MODULE)
      // Project templates ship `.venv/` inside generated .gitignore text and
      // `source .venv/bin/activate` inside README instructions. That is
      // scaffold CONTENT handed to the user, not interpreter discovery.
      .filter(file => !file.startsWith('src/renderer/data/projectTemplates/'))
      .filter(file => VENV_LAYOUT.test(read(file)));

    expect(
      handRolled,
      handRolled.length === 0
        ? ''
        : 'These files know about virtualenv interpreter layouts outside the ' +
            `policy module:\n  ${handRolled.join('\n  ')}\n` +
            `If one resolves a Python interpreter, route it through ${POLICY_MODULE} ` +
            'and add it to PYTHON_SPAWNING_SURFACES. If it only ships that text to ' +
            'users, exclude it here with a reason.'
    ).toEqual([]);
  });

  it('keeps the policy module documenting the surfaces it serves', () => {
    const policy = read(POLICY_MODULE);

    expect(policy).toContain('CLI');
    expect(policy).toContain('test runner');
    expect(policy).toContain('debugger');
  });
});
