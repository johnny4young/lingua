/**
 * Runs the auto-log AST pass under a local CPython, the parser Pyodide embeds.
 * Skipped where no python3 is installed.
 *
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PYTHON_AUTO_LOG_HELPERS_SOURCE } from '../../src/renderer/workers/python-worker-auto-log-source';
import { PYTHON_CELL_SOURCE } from '../../src/renderer/workers/python-worker-cell-source';
import { PYTHON_CELL_ANSWER_SOURCE } from '../../src/renderer/workers/python-worker-cell-answer-source';

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
# Notebook cells record their answers straight into the worker's magic list.
records = ns["__lingua_magic_results"] = []
scope = {k: v for k, v in ns.items() if k.startswith("__lingua") or k == "__mc"}
outcome = "ok"
try:
    asyncio.run(ns["__lingua_execute_auto_log"](sys.argv[1], scope, sys.argv[2] or None))
except Exception as error:
    outcome = type(error).__name__
for record in records:
    head = [record["line"], "error"] if record.get("is_error") else [record["line"]]
    answers.append(head + [record["value"]] + ([record["size"]] if "size" in record else []))
print(json.dumps({"outcome": outcome, "answers": answers, "names": sorted(k for k in scope if not k.startswith("__"))}))
`;

function run(code: string, mode: '' | 'assignments' | 'cell'): { outcome: string; answers: unknown[]; names: string[] } {
  const result = spawnSync('python3', ['-I', '-c', HARNESS, code, mode], {
    input: `${PYTHON_AUTO_LOG_HELPERS_SOURCE}\n${PYTHON_CELL_ANSWER_SOURCE}`,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

// Runs each cell in turn against one shared scope and reports the line the last error answers on.
const CELL_HARNESS = `
import asyncio, json, sys
ns = {"__lingua_cell_codes": None, "__lingua_error_line": None}
exec(sys.stdin.read(), ns)
ns["__mc"] = lambda line, fn, directive=None, kind=None: fn()
ns["__lingua_magic_results"] = []
scope = {k: v for k, v in ns.items() if k.startswith("__lingua") or k == "__mc"}
for source in json.loads(sys.argv[1]):
    ns["__lingua_error_line"] = None
    try:
        asyncio.run(ns["__lingua_execute_cell"](source, scope))
    except Exception:
        pass
print(json.dumps({"line": ns["__lingua_error_line"]}))
`;

function runCells(cells: string[]): { line: number | null } {
  const result = spawnSync('python3', ['-I', '-c', CELL_HARNESS, JSON.stringify(cells)], {
    input: `${PYTHON_AUTO_LOG_HELPERS_SOURCE}\n${PYTHON_CELL_ANSWER_SOURCE}\n${PYTHON_CELL_SOURCE}`,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe.skipIf(!hasPython)('Python notebook cells under CPython', () => {
  it('answers an error raised in a function another cell defined on the line that called it', () => {
    expect(runCells(['def boom():\n    raise ValueError("x")', 'ready = 1\nboom()'])).toEqual({ line: 2 });
  });

  it('answers an error inside a function of the same cell on the line that raised it', () => {
    expect(runCells(['def boom():\n    raise ValueError("x")\n\nboom()'])).toEqual({ line: 2 });
  });
});

describe.skipIf(!hasPython)('Python auto-log under CPython', () => {
  it('answers notebook assignments and expressions on their lines', () => {
    const result = run('tickets = [151.2, 146.9]\na, b = 1, 2\n__lp0 = 0\nlen(tickets)', 'cell');
    expect(result).toMatchObject({
      outcome: 'ok',
      answers: [
        [1, '[151.2, 146.9]', 2],
        [2, '(1, 2)', 2],
        [4, '2'],
      ],
    });
  });

  it('bounds a notebook answer before building it and sends the length of a collection', () => {
    const result = run(
      [
        'readings = list(range(100000))',
        'huge = 2 ** 20000',
        'labels = {f"k{i}": "x" * 50 for i in range(2000)}',
        'note = "y" * 5000',
        'loop = []',
        'loop.append(loop)',
        'loop',
        '(7,)',
        'set()',
      ].join('\n'),
      'cell'
    );
    expect(result.outcome).toBe('ok');
    const [readings, huge, labels, note, , loop, single, empty] = result.answers as Array<[number, string, number?]>;
    expect(readings![1]).toMatch(/^\[0, 1, 2, .*, …$/);
    expect(readings![1].length).toBeLessThan(260);
    expect(readings![2]).toBe(100000);
    expect(huge).toEqual([2, '398027684033796659235430720619120245370477278049242593871342…', 6021]);
    expect(labels![1]).toMatch(/^\{'k0': 'x+', .*, …$/);
    expect(labels![2]).toBe(2000);
    expect(note![1]).toMatch(/^'y{200}\.\.\.'$/);
    expect(note).toHaveLength(2);
    expect(loop).toEqual([7, '[[...]]', 1]);
    expect(single).toEqual([8, '(7,)', 1]);
    expect(empty).toEqual([9, 'set()', 0]);
  });

  it('counts the digits of an int too long for the answer', () => {
    expect(run('big = 2 ** 1000\nneg = -(10 ** 250)', 'cell').answers).toEqual([
      [1, String(2n ** 1000n), 302],
      [2, String(-(10n ** 250n)), 251],
    ]);
  });

  it('answers a failing repr as an error without stopping the cell', () => {
    const result = run('class Bad:\n    def __repr__(self): raise RuntimeError("no repr")\nBad()\nafter = 1', 'cell');
    expect(result).toMatchObject({ outcome: 'ok', answers: [[3, 'error', 'no repr'], [4, '1']] });
  });

  it('lets a failing notebook expression stop the cell', () => {
    expect(run("1/0\nprint('after')", 'cell')).toMatchObject({ outcome: 'ZeroDivisionError', answers: [] });
  });

  it('keeps walrus bindings, async comprehensions and awaits at module scope', () => {
    const result = run(
      'import asyncio\n(y := 5)\nasync def agen():\n    yield 1\n[x async for x in agen()]\nz = await asyncio.sleep(0, result=9)',
      'cell'
    );
    expect(result.outcome).toBe('ok');
    expect(result.answers).toEqual([
      [2, '5'],
      [5, '[1]', 1],
      [6, '9'],
    ]);
    expect(result.names).toEqual(expect.arrayContaining(['y', 'z']));
  });

  it('keeps Scratchpad auto-log as before: expressions only, errors recorded', () => {
    expect(run('value = 21\nvalue * 2\n1/0', '')).toMatchObject({
      outcome: 'ok',
      answers: [
        [2, '42'],
        [3, 'error', 'division by zero'],
      ],
    });
  });

  it('answers Scratchpad assignments and keeps expression errors recorded', () => {
    const code = [
      'api = [38, 41]',
      'report = [',
      '    {"service": n}',
      '    for n in ["api", "db"]',
      ']',
      'a, b = 1, 2',
      'total = 1',
      'total += 1',
      '__lp0 = 0',
      'hidden: int',
      'for name in ["x"]:',
      '    inner = name',
      '1/0',
    ].join('\n');
    expect(run(code, 'assignments')).toMatchObject({
      outcome: 'ok',
      answers: [
        [1, '[38, 41]'],
        [2, "[{'service': 'api'}, {'service': 'db'}]"],
        [6, '(1, 2)'],
        [7, '1'],
        [8, '2'],
        [13, 'error', 'division by zero'],
      ],
    });
  });

  it('lets an explicit capture on the line win over its assignment answer', () => {
    const watched = 'x = 5; __mc(1, lambda: (x * 10))\ny = 2';
    expect(run(watched, 'assignments').answers).toEqual([
      [1, '50'],
      [2, '2'],
    ]);
  });
});
