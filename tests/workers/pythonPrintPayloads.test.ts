import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildPythonExecutionBootstrapSource } from '../../src/renderer/workers/python-worker-sources';

const hasPython = spawnSync('python3', ['--version']).status === 0;

/** Run the real bootstrap under CPython and return the captured print entries. */
function printEntries(userCode: string): Array<{ text: string; payloads: unknown[] }> {
  const bootstrap = buildPythonExecutionBootstrapSource({
    richConsoleEnabled: true,
    sourceMappingEnabled: false,
  });
  const dump = '\nimport json\nsys.__stdout__.write(json.dumps(__lingua_print_entries))\n';
  const result = spawnSync('python3', ['-c', `${bootstrap}\n${userCode}${dump}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe.skipIf(!hasPython)('Python print payloads', () => {
  it('shows top-level string arguments as print does, without repr quotes', () => {
    const [entry] = printEntries('print("sum =", 55)\n');
    expect(entry?.text).toBe('sum = 55\n');
    expect(entry?.payloads).toEqual([
      { kind: 'primitive', type: 'string', repr: 'sum =' },
      { kind: 'primitive', type: 'number', repr: '55' },
    ]);
  });

  it('keeps repr for strings nested in containers, matching print', () => {
    const [entry] = printEntries('print(["a"], "b")\n');
    expect(entry?.text).toBe("['a'] b\n");
    expect(entry?.payloads).toEqual([
      {
        kind: 'array',
        length: 1,
        entries: [{ index: 0, value: { kind: 'primitive', type: 'string', repr: "'a'" } }],
      },
      { kind: 'primitive', type: 'string', repr: 'b' },
    ]);
  });
});
