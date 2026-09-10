/**
 * One Python interpreter discovery policy for every surface that spawns
 * Python: the CLI (`lingua run`), the project test runner, and the debugger.
 *
 * These three carried three different candidate lists. On Windows the
 * divergence was real — the debugger only ever looked for `python`, the test
 * runner never looked for `python3`, and the CLI never looked inside a `venv`
 * directory without the leading dot — so the same project could resolve to
 * three different interpreters depending on which surface asked.
 *
 * What is shared is the POLICY: which names to try, in what order, which
 * virtualenv layouts to look for, whether to walk up toward the filesystem
 * root, and whether `PYTHON` in the environment wins.
 *
 * What is NOT shared is the PROBE, because the three surfaces legitimately
 * need different evidence:
 *
 *   - the CLI scans PATH against the environment the CHILD will be spawned
 *     with, since `--env PATH=...` makes parent and child diverge;
 *   - the project test runner scans only ABSOLUTE PATH segments, because a
 *     relative entry would resolve against an untrusted project directory
 *     and allow binary planting;
 *   - the debugger spawns `--version`, because it needs an interpreter that
 *     actually runs, not a file that merely exists.
 *
 * So `pythonInterpreterCandidates` is pure and synchronous — no filesystem,
 * no spawning, no `process` access beyond what the caller passes in — and
 * `resolvePythonInterpreter` is a thin loop over it with the probe injected.
 * That keeps the whole platform matrix unit-testable on any host.
 *
 * This module deliberately takes `platform` for BOTH the path flavour and the
 * command list. The CLI previously mixed the two, joining venv paths with the
 * host's `process.platform` while choosing command names from the argument,
 * which made a win32 case impossible to exercise from a posix test host.
 */

import path from 'node:path';

/**
 * Where a candidate came from, so a caller can probe each kind its own way.
 * Deliberately not exported: consumers narrow on the literal via
 * `candidate.source === 'path'`, so an exported alias nothing imports would be
 * dead surface.
 */
type PythonCandidateSource = 'venv' | 'python-env' | 'path';

export interface PythonCandidate {
  /**
   * For `venv` and `python-env`, an interpreter path. For `path`, a bare
   * command name still to be located on PATH.
   */
  command: string;
  source: PythonCandidateSource;
}

export interface PythonCandidateOptions {
  /** Directory the search starts from — a project root, or the CLI's cwd. */
  startDirectory: string;
  platform: NodeJS.Platform;
  /** Environment the interpreter will actually be spawned with. */
  env?: NodeJS.ProcessEnv;
  /**
   * Walk from `startDirectory` toward the filesystem root looking for a
   * virtualenv. The CLI needs this because `lingua run` is often invoked from
   * a subdirectory; the main-process surfaces already hold a project root and
   * leave it off.
   */
  walkUp?: boolean;
  /**
   * Honour `PYTHON` in `env`. CLI-only today: extending an environment
   * override to processes launched on behalf of an arbitrary opened project
   * is a separate security decision, so main leaves this off.
   */
  respectPythonEnv?: boolean;
}

/**
 * PATH command names in priority order.
 *
 * Windows ships a `py` launcher and frequently has `python` shimmed to the
 * Microsoft Store stub, so all three names stay in play; elsewhere `python`
 * may still be Python 2, so `python3` leads.
 */
export function pythonCommandCandidates(platform: NodeJS.Platform): ReadonlyArray<string> {
  return platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
}

/**
 * Virtualenv interpreter locations relative to a directory, most conventional
 * first. `.venv` wins over `venv` when a project somehow has both.
 */
export function pythonVenvRelativePaths(platform: NodeJS.Platform): ReadonlyArray<string> {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return platform === 'win32'
    ? [
        pathApi.join('.venv', 'Scripts', 'python.exe'),
        pathApi.join('venv', 'Scripts', 'python.exe'),
      ]
    : [pathApi.join('.venv', 'bin', 'python'), pathApi.join('venv', 'bin', 'python')];
}

/**
 * The ordered candidates to try: project virtualenvs first (they are the
 * project's declared intent), then an explicit `PYTHON` override, then PATH.
 *
 * Pure and synchronous. Nothing here touches the filesystem, so a caller can
 * probe the list however its surface requires.
 */
export function pythonInterpreterCandidates(
  options: PythonCandidateOptions
): ReadonlyArray<PythonCandidate> {
  const { startDirectory, platform, env, walkUp = false, respectPythonEnv = false } = options;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const relatives = pythonVenvRelativePaths(platform);
  const candidates: PythonCandidate[] = [];

  let current = startDirectory;
  for (;;) {
    for (const relative of relatives) {
      candidates.push({ command: pathApi.join(current, relative), source: 'venv' });
    }
    if (!walkUp) break;
    const parent = pathApi.dirname(current);
    // `dirname` is a fixed point at the root on both flavours, which is what
    // terminates the walk. A relative `startDirectory` bottoms out at '.'.
    if (parent === current) break;
    current = parent;
  }

  const pythonEnv = respectPythonEnv ? env?.PYTHON : undefined;
  if (pythonEnv) candidates.push({ command: pythonEnv, source: 'python-env' });

  for (const name of pythonCommandCandidates(platform)) {
    candidates.push({ command: name, source: 'path' });
  }

  return candidates;
}

/**
 * Walk the candidates and return what the probe accepts.
 *
 * The probe returns the value to use — not a boolean — so a surface that
 * resolves a bare PATH name into an absolute path can hand that back, while
 * one that spawns the name directly can return the name. `null` means the
 * candidate was rejected; `null` from this function means every candidate was.
 *
 * Callers own the no-match behaviour. The CLI falls back to its first command
 * name so the eventual spawn produces a recognisable error; the main-process
 * surfaces report a missing toolchain instead.
 */
export async function resolvePythonInterpreter(
  options: PythonCandidateOptions,
  probe: (candidate: PythonCandidate) => Promise<string | null>
): Promise<string | null> {
  for (const candidate of pythonInterpreterCandidates(options)) {
    const resolved = await probe(candidate);
    if (resolved !== null) return resolved;
  }
  return null;
}
