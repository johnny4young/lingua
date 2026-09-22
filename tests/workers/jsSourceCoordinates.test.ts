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
