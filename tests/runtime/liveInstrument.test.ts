// @vitest-environment node
import { Parser } from 'acorn';
import { describe, expect, it } from 'vitest';
import { instrumentForLive } from '@/runtime/liveInstrument';

const parses = (code: string) =>
  expect(() =>
    Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true })
  ).not.toThrow();

/** Runs instrumented code with recording probes; `end N:P` is loop N closing after P passes. */
function trace(source: string) {
  const { code, loops } = instrumentForLive(source);
  const lines: number[] = [];
  const events: string[] = [];
  const open: Array<() => number> = [];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('__lingua_live', '__lingua_loop', '__lingua_loop_end', '__lingua_pass', '__lingua_of', code);
  fn(
    (line: number) => lines.push(line),
    (id: number, pass: () => number) => {
      open.push(pass);
      events.push(`loop ${id}`);
    },
    (id: number) => events.push(`end ${id}:${open.pop()!()}`),
    () => events.push('call'),
    (id: number, value: unknown) => {
      events.push(`of ${id}`);
      return value;
    }
  );
  return { code, loops, lines, events };
}

describe('instrumentForLive', () => {
  it('probes each statement that can take time, on its own line, and keeps the line count', () => {
    const source = ['const a = Number("1");', 'function f(x) {', '  const y = Math.abs(x);', '  return String(y);', '}', 'f(a);', 'const b = a + 1;', 'if (b > 1) f(b);'].join('\n');
    const { code, lines } = trace(source);
    expect(code.split('\n')).toHaveLength(8);
    // Line 7 has no call, so it cannot hold the run; line 8's test has none either, its body runs f again.
    expect(lines).toEqual([1, 6, 3, 4, 3, 4]);
  });

  it('opens, passes and closes each loop, nested and labeled', () => {
    const source = [
      'outer: for (let i = 0; i < 2; i++) {',
      '  for (const v of [1, 2, 3]) {',
      '    if (v === 2) continue outer;',
      '  }',
      '}',
    ].join('\n');
    const { loops, events } = trace(source);
    expect(loops).toEqual([1, 2]);
    // Only the first pass of each execution calls out; the rest count in place.
    expect(events).toEqual(['loop 0', 'call', 'loop 1', 'of 1', 'call', 'end 1:2', 'loop 1', 'of 1', 'call', 'end 1:2', 'end 0:2']);
  });

  it('keeps a parenthesized sequence as the iterable of a for-of', () => {
    const { code } = trace('const seen = [];\nfor (const v of ([0], [1, 2])) seen.push(v);\nif (seen.join() !== "1,2") throw new Error(seen.join());');
    parses(code);
  });

  it('wraps loops with a single-statement body, including one loop as another loop body', () => {
    const source = 'let n = 0;\nfor (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) n++;\nwhile (n > 2) n--;\ndo n--; while (n > 0)';
    const { code, events, lines } = trace(source);
    parses(code);
    expect(events.filter(event => event.startsWith('end'))).toEqual(['end 1:2', 'end 1:2', 'end 0:2', 'end 2:2', 'end 3:2']);
    // A loop is always probed, here the inner one once per outer pass; n++ never is.
    expect(lines).toEqual([2, 2, 2, 3, 4]);
  });

  it('closes a loop that returns or throws out of it', () => {
    const source = ['function first(xs) {', '  for (const x of xs) {', '    if (x > 1) return x;', '  }', '}', 'first([1, 2, 3]);', 'try { while (true) throw new Error("x"); } catch {}'].join('\n');
    const { events } = trace(source);
    expect(events).toEqual(['loop 0', 'of 0', 'call', 'end 0:2', 'loop 1', 'call', 'end 1:1']);
  });

  it('does not track loops of async functions or generators, but still probes their lines', () => {
    const source = ['async function a() {', '  for (const x of [1]) await x;', '}', 'function* g() {', '  for (const x of [1]) yield x;', '}', '[...g()];', 'a();'].join('\n');
    const { events, lines, loops } = trace(source);
    expect(loops).toEqual([]);
    expect(events).toEqual([]);
    expect(lines).toEqual(expect.arrayContaining([2, 5, 7, 8]));
  });

  it('skips injected statements and lines past the source', () => {
    const source = 'var __lp0=0; for (let i = 0; i < 1; i++) { if(++__lp0>10) throw new Error("x"); __mc_tick(1); const a = String(i); }\n__lingua_capture_scope({});';
    const { code } = instrumentForLive(source, { maxLine: 1 });
    expect(code).not.toMatch(/__lingua_live\(1\); var __lp0/);
    expect(code).not.toMatch(/__lingua_live\(\d+\); if\(\+\+__lp0/);
    expect(code).not.toMatch(/__lingua_live\(\d+\); __mc_tick/);
    expect(code).not.toMatch(/__lingua_live\(2\)/);
    expect(code).toMatch(/__lingua_live\(1\); const a = String\(i\);/);
  });

  it('calls out once per 128 passes of a hot loop', () => {
    const { events } = trace('let n = 0;\nfor (let i = 0; i < 300; i++) n += i;');
    expect(events).toEqual(['loop 0', 'call', 'call', 'call', 'end 0:300']);
  });

  it('throws on malformed code like the other instrumenters', () => {
    expect(() => instrumentForLive('for (')).toThrow();
  });
});
