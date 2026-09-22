// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transform } from 'esbuild';
import type { WorkerResponse } from '@/types/execution';
import { transformJSLineTiming, transformJSMagicComments, transformJSAutoLog } from '@/utils/magicComments';
import { injectJSLoopProtection } from '@/utils/loopProtection';
import { instrumentForDebugger } from '@/runtime/debuggerInstrument';

async function execute(code: string, sourceMaps: string[] = [], sourceLineCount?: number) {
  vi.resetModules();
  const messages: WorkerResponse[] = [];
  const port = { postMessage: (message: WorkerResponse) => messages.push(message) };
  vi.stubGlobal('self', port);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  await createJsWorkerMessageHandler(port as unknown as Worker)({ data: {
    type: 'execute', runId: 'coordinates', code, sourceMaps, sourceLineCount,
  } } as MessageEvent);
  return messages;
}

afterEach(() => vi.unstubAllGlobals());

describe('worker source coordinates', () => {
  it('reports an untransformed exception on its original line and column', async () => {
    const messages = await execute('throw new Error("mapped crash")');
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({
      message: 'mapped crash', line: 1, column: 7,
    });
  });

  it('classifies runtime frames separately from original user frames', async () => {
    const messages = await execute('throw new Error("frame marker")');
    const frames = messages.find(message => message.type === 'error')?.error.frames ?? [];
    expect(frames.some(frame => frame.text === 'Error: frame marker')).toBe(false);
    expect(frames.find(frame => frame.provenance === 'user')).toMatchObject({ line: 1, column: 7 });
    expect(frames.some(frame => frame.provenance === 'runtime')).toBe(true);
    expect(frames.filter(frame => frame.provenance === 'runtime').every(frame => !frame.file)).toBe(true);
  });

  it.each([
    'problem', '{ problem }', 'new Map([["problem", problem]])',
    'new Set([problem])', '[{ problem }]',
  ])('retains mapped Error stacks inside logged %s values', async expression => {
    const maps: string[] = [];
    const code = transformJSLineTiming(`const problem = new Error("logged marker");\nconsole.error(${expression});`, [1, 2], map => maps.unshift(map));
    const messages = await execute(code, maps, 2);
    const output = messages.find(message => message.type === 'console');
    const serialized = JSON.stringify(output?.payload);
    expect(serialized).toContain('user code:1:17');
    expect(serialized).toContain('"provenance":"user"');
    expect(messages.some(message => message.type === 'error')).toBe(false);
  });

  it('keeps unknown dependency frames visible and does not change the Error', async () => {
    const { createJsWorkerSourceMapper } = await import('@/workers/js-worker-source');
    const source = await createJsWorkerSourceMapper();
    const error = new Error('dependency');
    error.stack = 'Error: dependency\n    at external (https://example.invalid/library.js:8:2)';
    Object.freeze(error);
    expect(source.errorFrames(error)).toEqual([{ text: 'at external (https://example.invalid/library.js:8:2)',
      file: 'https://example.invalid/library.js', line: 8, column: 2, fnName: 'external' }]);
    expect(error.stack).toContain('Error: dependency');
  });

  it('keeps logging usable when an Error stack accessor throws', async () => {
    const messages = await execute('const error = new Error("opaque"); Object.defineProperty(error, "stack", { get() { throw new Error("private"); } }); console.error(error); console.log("still running");');
    expect(messages.some(message => message.type === 'error')).toBe(false);
    expect(messages.filter(message => message.type === 'console')).toHaveLength(2);
  });

  it('maps Error cells passed to console.table', async () => {
    const messages = await execute('console.table([{ problem: new Error("table marker") }]);');
    expect(JSON.stringify(messages.find(message => message.type === 'console')?.payload)).toContain('user code:1:27');
  });

  it('locates native syntax failures without executing a second copy of user code', async () => {
    const maps: string[] = [];
    const code = transformJSLineTiming('const value = 1;\nconst broken = ;', [1, 2], map => maps.unshift(map));
    const messages = await execute(code, maps, 2);
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({ line: 2, column: 16 });
  });

  it('composes timing and TypeScript transforms instead of guessing a wrapper offset', async () => {
    const original = 'type User = { name: string };\nconst user: User = { name: "ok" };\nthrow new Error(user.name);';
    const maps: string[] = [];
    const code = transformJSLineTiming(original, [2, 3], map => maps.unshift(map));
    const compiled = await transform(code, { loader: 'ts', sourcemap: 'external', target: 'es2022' });
    maps.unshift(compiled.map);
    const messages = await execute(compiled.code, maps, 3);
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({
      message: 'ok', line: 3, column: 7,
    });
  });

  it.each(['arrow', 'watch'] as const)('keeps %s exceptions classified and maps their source expression', async kind => {
    const original = kind === 'arrow' ? 'JSON.parse("bad") //=>' : '// @watch JSON.parse("bad")';
    const maps: string[] = [];
    const code = transformJSMagicComments(original, map => maps.unshift(map));
    const messages = await execute(code + '\n__mc(2, 42)', maps, 2);
    const captures = messages.filter(message => message.type === 'magic-comment');
    expect(captures[0]).toMatchObject({ isError: true, error: { line: 1, column: kind === 'arrow' ? 6 : 16 } });
    expect(captures[1]).toMatchObject({ line: 2, value: '42' });
    expect(messages.some(message => message.type === 'error')).toBe(false);
  });

  it('maps console and throw sites through loop and debugger instrumentation', async () => {
    const original = 'for (let i = 0; i < 1; i++) {\n  console.log(i);\n  throw new Error("loop");\n}';
    const maps: string[] = [];
    const protectedCode = injectJSLoopProtection(original, 10, map => maps.unshift(map));
    const instrumented = instrumentForDebugger(protectedCode);
    maps.unshift(instrumented.map);
    const messages = await execute(instrumented.code, maps, 4);
    expect(messages.find(message => message.type === 'console')).toMatchObject({ line: 2 });
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({ line: 3, column: 9 });
  });

  it('anchors an injected loop-limit failure to the protected source line', async () => {
    const maps: string[] = [];
    const code = injectJSLoopProtection('while (true) {\n}', 2, map => maps.unshift(map));
    const messages = await execute(code, maps, 2);
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({ line: 1 });
  });

  it('preserves UTF-16 columns and CRLF lines through instrumentation', async () => {
    const maps: string[] = [];
    const statement = 'const emoji = "🦀"; throw new Error(emoji);';
    const code = transformJSLineTiming('// prefix\r\n' + statement, [2], map => maps.unshift(map));
    const messages = await execute(code, maps, 2);
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({
      line: 2, column: statement.indexOf('new Error') + 1,
    });
  });

  it('maps an auto-captured exception without losing its later value', async () => {
    const maps: string[] = [];
    const code = transformJSAutoLog('  JSON.parse("bad")\n42', [1, 2], map => maps.unshift(map));
    const messages = await execute(code, maps, 2);
    const captures = messages.filter(message => message.type === 'magic-comment');
    expect(captures[0]).toMatchObject({ isError: true, error: { line: 1, column: 8 } });
    expect(captures[1]).toMatchObject({ line: 2, value: '42' });
  });
});
