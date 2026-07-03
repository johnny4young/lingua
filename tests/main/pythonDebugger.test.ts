/**
 * RL-027 Slice 2 / T18 — Python debugger bridge engine.
 *
 * `parsePdbLocation` is a pure unit test. The session tests drive a REAL
 * `python3 -m pdb` subprocess (the engine's whole point is the pdb REPL
 * protocol, which a mock can't validate), so they are skipped when python3
 * is not on PATH — a python-less CI shard stays green, an Ubuntu runner /
 * dev box exercises the real protocol.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PythonDebugSession,
  parsePdbLocation,
} from '../../src/main/pythonDebugger';

function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version']);
    if (probe.status === 0 || probe.stdout || probe.stderr) return candidate;
  }
  return null;
}

const pythonPath = findPython();
const describeReal = pythonPath ? describe : describe.skip;

describe('parsePdbLocation', () => {
  it('parses a top-level module stop with its source line', () => {
    const loc = parsePdbLocation('> /tmp/a.py(1)<module>()\n-> x = 1\n(Pdb) ');
    expect(loc).toEqual({
      file: '/tmp/a.py',
      line: 1,
      func: '<module>',
      sourceLine: 'x = 1',
    });
  });

  it('parses a stop inside a function', () => {
    const loc = parsePdbLocation('> /tmp/a.py(4)add()\n-> total = a + b');
    expect(loc?.func).toBe('add');
    expect(loc?.line).toBe(4);
  });

  it('returns null when there is no stop line', () => {
    expect(parsePdbLocation('Breakpoint 1 at /tmp/a.py:4\n(Pdb) ')).toBeNull();
  });
});

describeReal('PythonDebugSession (real pdb)', () => {
  let dir: string;
  let scriptPath: string;
  const sessions: PythonDebugSession[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lingua-pdb-'));
    scriptPath = join(dir, 'prog.py');
    writeFileSync(
      scriptPath,
      [
        'x = 1',
        'y = 2',
        'def add(a, b):',
        '    total = a + b',
        '    return total',
        'z = add(x, y)',
        'print("result", z)',
        '',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(() => {
    for (const s of sessions.splice(0)) s.terminate();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function newSession(): PythonDebugSession {
    const session = new PythonDebugSession({ scriptPath, pythonPath: pythonPath! });
    sessions.push(session);
    return session;
  }

  it('starts and pauses at the top of the module', async () => {
    const session = newSession();
    const start = await session.start();
    expect(start.location?.line).toBe(1);
    expect(start.location?.func).toBe('<module>');
    expect(session.isRunning).toBe(true);
  });

  it('hits a breakpoint, evaluates locals, steps, and finishes', async () => {
    const session = newSession();
    await session.start();

    await session.setBreakpoint(4); // total = a + b
    const hit = await session.continue();
    expect(hit.location?.line).toBe(4);
    expect(hit.location?.func).toBe('add');

    // Arguments are in scope at the breakpoint.
    expect((await session.evaluate('a')).trim()).toBe('1');
    expect((await session.evaluate('b')).trim()).toBe('2');

    // Step over the assignment → `total` becomes defined on the next line.
    const stepped = await session.stepOver();
    expect(stepped.location?.line).toBe(5); // return total
    expect((await session.evaluate('total')).trim()).toBe('3');

    // Run to completion.
    const done = await session.continue();
    expect(done.finished).toBe(true);
  });

  it('surfaces program stdout before the program finishes', async () => {
    const session = newSession();
    await session.start();
    const done = await session.continue(); // no breakpoints → run to end
    expect(done.finished).toBe(true);
    expect(done.output).toContain('result 3');
  });

  it('terminate() stops a running session', async () => {
    const session = newSession();
    await session.start();
    expect(session.isRunning).toBe(true);
    session.terminate();
    // sendCommand after terminate rejects rather than hanging.
    await expect(session.continue()).rejects.toThrow(/not running/i);
  });
});
