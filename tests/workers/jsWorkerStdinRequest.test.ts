// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// The worker modules read `self` on import; here it is the test's globalThis.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self = globalThis;
});

import { JsWorkerStdinRequest, STDIN_PROMPT_CHARS } from '@/workers/js-worker-stdin';

type Message = { type: string; [key: string]: unknown };

/** Runs code through the real JS worker handler. */
async function run(code: string, extra: Record<string, unknown>) {
  vi.resetModules();
  const messages: Message[] = [];
  vi.stubGlobal('postMessage', (message: Message) => messages.push(message));
  vi.stubGlobal('self', globalThis);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  const handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  await handler({ data: { type: 'execute', runId: 'ask', code, ...extra } } as MessageEvent);
  return messages;
}

afterEach(() => vi.unstubAllGlobals());

describe('JS worker stdin requests', () => {
  it('stops at the first prompt with no line left and reports its text instead of an error', async () => {
    const messages = await run('const a = prompt("first"); const b = prompt("Your name?"); console.log(a, b);', { stdin: 'one', askStdin: true });
    expect(messages.find(message => message.type === 'stdin-request')).toMatchObject({ message: 'Your name?' });
    expect(messages.some(message => message.type === 'error')).toBe(false);
    expect(messages.some(message => message.type === 'console')).toBe(false);
    expect(messages.at(-1)?.type).toBe('done');
  });

  it('asks even with an empty buffer, and readline asks without a message', async () => {
    const messages = await run('readline();', { askStdin: true });
    expect(messages.find(message => message.type === 'stdin-request')).toMatchObject({ message: '' });
  });

  it('keeps the old behavior without askStdin', async () => {
    const messages = await run('const v = prompt("x"); console.log(String(v));', { stdin: '', askStdin: false });
    expect(messages.some(message => message.type === 'stdin-request')).toBe(false);
    expect(messages.find(message => message.type === 'error')).toMatchObject({ error: { message: expect.stringContaining('prompt') } });
  });

  it('cuts long prompts and survives a prompt that cannot become text', () => {
    expect(new JsWorkerStdinRequest('p'.repeat(500), 3).message).toHaveLength(STDIN_PROMPT_CHARS);
    expect(new JsWorkerStdinRequest({ toString: () => { throw new Error('no'); } }, undefined).message).toBe('');
  });
});
