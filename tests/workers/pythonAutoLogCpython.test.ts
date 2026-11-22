/**
 * Runs the auto-log AST pass under a local CPython, the parser Pyodide embeds.
 * Skipped where no python3 is installed.
 *
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PYTHON_AUTO_LOG_HELPERS_SOURCE } from '../../src/renderer/workers/python-worker-auto-log-source';

const hasPython = spawnSync('python3', ['--version']).status === 0;

const HARNESS = `
import asyncio, json, sys
ns = {}
exec(sys.stdin.read(), ns)
answers = []
def __mc(line, fn, directive=None, kind=None):
    try:
        value = fn()
    except Exception as error:
        answers.append([line, "error", str(error)])
        return None
    if value is not None:
        answers.append([line, repr(value)])
    return value
ns["__mc"] = __mc
scope = {k: v for k, v in ns.items() if k.startswith("__lingua") or k == "__mc"}
outcome = "ok"
try:
    asyncio.run(ns["__lingua_execute_auto_log"](sys.argv[1], scope, sys.argv[2] == "1"))
except Exception as error:
    outcome = type(error).__name__
print(json.dumps({"outcome": outcome, "answers": answers, "names": sorted(k for k in scope if not k.startswith("__"))}))
`;

function run(code: string, assignments: boolean): { outcome: string; answers: unknown[]; names: string[] } {
  const result = spawnSync('python3', ['-I', '-c', HARNESS, code, assignments ? '1' : '0'], {
    input: PYTHON_AUTO_LOG_HELPERS_SOURCE,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe.skipIf(!hasPython)('Python auto-log under CPython', () => {
  it('answers notebook assignments and expressions on their lines', () => {
    const result = run('tickets = [151.2, 146.9]\na, b = 1, 2\n__lp0 = 0\nlen(tickets)', true);
    expect(result).toMatchObject({
      outcome: 'ok',
      answers: [
        [1, '[151.2, 146.9]'],
        [2, '(1, 2)'],
        [4, '2'],
      ],
    });
  });

  it('lets a failing notebook expression stop the cell', () => {
    expect(run("1/0\nprint('after')", true)).toMatchObject({ outcome: 'ZeroDivisionError', answers: [] });
  });

  it('keeps walrus bindings, async comprehensions and awaits at module scope', () => {
    const result = run(
      'import asyncio\n(y := 5)\nasync def agen():\n    yield 1\n[x async for x in agen()]\nz = await asyncio.sleep(0, result=9)',
      true
    );
    expect(result.outcome).toBe('ok');
    expect(result.answers).toEqual([
      [2, '5'],
      [5, '[1]'],
      [6, '9'],
    ]);
    expect(result.names).toEqual(expect.arrayContaining(['y', 'z']));
  });

  it('keeps Scratchpad auto-log as before: expressions only, errors recorded', () => {
    expect(run('value = 21\nvalue * 2\n1/0', false)).toMatchObject({
      outcome: 'ok',
      answers: [
        [2, '42'],
        [3, 'error', 'division by zero'],
      ],
    });
  });
});
