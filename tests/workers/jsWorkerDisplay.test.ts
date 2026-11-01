// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { self?: unknown }).self = globalThis;
});

type Message = { type: string; [key: string]: unknown };

async function run(code: string, richDisplay = true) {
  vi.resetModules();
  const messages: Message[] = [];
  vi.stubGlobal('postMessage', (message: Message) => messages.push(message));
  vi.stubGlobal('self', globalThis);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  const handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  await handler({ data: { type: 'execute', runId: 'disp', code, richDisplay } } as MessageEvent);
  return { console: messages.filter(message => message.type === 'console'), errors: messages.filter(message => message.type === 'error') };
}

afterEach(() => vi.unstubAllGlobals());

describe('JS worker lingua.display', () => {
  it('posts a typed payload, and a rejection the runner reports, for each display call', async () => {
    const messages = (await run('lingua.display([{ city: "Envigado", orders: 42 }]);\nlingua.display("<b>x</b>", { as: "html" });\nlingua.display("bad", { as: "image" });')).console;
    expect(messages[0]).toMatchObject({ payload: [{ kind: 'table' }] });
    expect(messages[1]).toMatchObject({ payload: [{ kind: 'html', html: '<b>x</b>' }] });
    expect(messages[2]).toMatchObject({ richMediaRejected: { kind: 'image', reason: 'invalid-src' } });
    expect(messages[2]).not.toHaveProperty('payload');
  });

  it('posts a progress bar only when its percent changes, ending at the last value', async () => {
    const messages = (await run('const bar = lingua.display.progress("import");\nfor (let i = 1; i <= 1000; i++) bar.update(i / 1000);\nconst other = lingua.display.progress("second");')).console;
    const first = messages.filter(message => (message.payload as Array<{ id: string }>)[0]!.id === 'disp:progress-1');
    expect(first).toHaveLength(101);
    expect(first.at(-1)).toMatchObject({ args: ['import 100%'], payload: [{ kind: 'progress', value: 1, label: 'import' }] });
    expect(messages.at(-1)).toMatchObject({ payload: [{ id: 'disp:progress-2', value: 0 }] });
  });

  it('throttles text-only progress changes', async () => {
    const messages = (await run('const bar = lingua.display.progress("t");\nfor (let i = 0; i < 500; i++) bar.update(0.5, "step " + i);')).console;
    expect(messages.length).toBeLessThan(20);
  });

  it('leaves lingua.display out with the Labs flag off', async () => {
    const result = await run('console.log(typeof lingua.display, typeof lingua.chart);', false);
    expect(result.console[0]).toMatchObject({ args: ['undefined', 'function'] });
  });
});
