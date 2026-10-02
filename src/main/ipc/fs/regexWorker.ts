/**
 * Runs user-supplied regular expressions in a worker thread so a
 * catastrophic-backtracking pattern cannot freeze the main process. A
 * hard deadline terminates the worker; V8 interrupts a running regex.
 */

import { Worker } from 'node:worker_threads';

// Plain source string: a bundled function's `toString()` can reference
// helpers the bundler injected outside it.
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');

function preview(request) {
  const re = new RegExp(request.source, request.flags);
  const single = new RegExp(request.source, request.flags.replace('g', ''));
  const deadline = Date.now() + request.perLineTimeoutMs * request.lines.length;
  const matches = [];
  let timedOut = false;
  for (let lineIndex = 0; lineIndex < request.lines.length; lineIndex += 1) {
    if (matches.length >= request.maxMatches) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const line = request.lines[lineIndex];
    if (line.length > request.maxLineLength) {
      timedOut = true;
      continue;
    }
    let lineMatches = 0;
    for (const m of line.matchAll(re)) {
      if (matches.length >= request.maxMatches) break;
      matches.push({
        lineIndex,
        index: m.index,
        text: m[0],
        replacement: m[0].replace(single, request.replacement),
      });
      lineMatches += 1;
      if (lineMatches >= request.maxMatchesPerLine) break;
    }
  }
  return { matches, timedOut };
}

function apply(request) {
  const re = new RegExp(request.source, request.flags);
  let replaced = 0;
  for (const _ of request.content.matchAll(re)) {
    replaced += 1;
    if (replaced > request.maxCount) break;
  }
  const next = replaced === 0
    ? request.content
    : request.content.replace(new RegExp(request.source, request.flags), request.replacement);
  return { replaced, next };
}

parentPort.on('message', (message) => {
  try {
    const value = message.kind === 'apply' ? apply(message) : preview(message);
    parentPort.postMessage({ id: message.id, ok: true, value });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: String(error && error.message || error) });
  }
});
`;

export interface RegexLineMatch {
  lineIndex: number;
  index: number;
  text: string;
  replacement: string;
}

interface RegexPreviewRequest {
  source: string;
  flags: string;
  replacement: string;
  lines: string[];
  maxMatches: number;
  maxMatchesPerLine: number;
  maxLineLength: number;
  perLineTimeoutMs: number;
}

interface RegexApplyRequest {
  source: string;
  flags: string;
  replacement: string;
  content: string;
  maxCount: number;
}

export class RegexTimeoutError extends Error {
  constructor() {
    super('Regular expression exceeded its time budget');
  }
}

/** Hard per-file budget, scaled with line count like the cooperative deadline. */
export function regexHardTimeoutMs(lineCount: number, perLineTimeoutMs: number): number {
  return Math.min(2_000, Math.max(250, perLineTimeoutMs * lineCount));
}

export interface RegexWorker {
  preview(
    request: RegexPreviewRequest,
    timeoutMs: number
  ): Promise<{ matches: RegexLineMatch[]; timedOut: boolean }>;
  apply(
    request: RegexApplyRequest,
    timeoutMs: number
  ): Promise<{ replaced: number; next: string }>;
  dispose(): void;
}

/** One lazily started worker per search or apply call; callers must `dispose()`. */
export function createRegexWorker(): RegexWorker {
  let worker: Worker | null = null;
  let online: Promise<void> | null = null;
  let nextId = 0;

  const dispose = () => {
    if (!worker) return;
    void worker.terminate();
    worker = null;
    online = null;
  };

  const start = (): { worker: Worker; online: Promise<void> } => {
    if (!worker || !online) {
      const created = new Worker(WORKER_SOURCE, { eval: true });
      created.unref();
      worker = created;
      online = new Promise<void>((resolve, reject) => {
        created.once('online', () => resolve());
        created.once('error', reject);
      });
    }
    return { worker, online };
  };

  const run = async <T>(message: Record<string, unknown>, timeoutMs: number): Promise<T> => {
    const { worker: active, online: ready } = start();
    // Start the clock once the worker runs, so thread startup is not billed to the regex.
    await ready;
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        active.off('message', onMessage);
        active.off('error', onError);
        active.off('exit', onExit);
      };
      const timer = setTimeout(() => {
        cleanup();
        dispose();
        reject(new RegexTimeoutError());
      }, timeoutMs);
      const onMessage = (reply: { id: number; ok: boolean; value?: T; error?: string }) => {
        if (reply.id !== id) return;
        cleanup();
        if (reply.ok) resolve(reply.value as T);
        else reject(new Error(reply.error));
      };
      const onError = (error: Error) => {
        cleanup();
        dispose();
        reject(error);
      };
      const onExit = () => {
        cleanup();
        reject(new Error('Regex worker exited unexpectedly'));
      };
      active.on('message', onMessage);
      active.on('error', onError);
      active.on('exit', onExit);
      active.postMessage({ id, ...message });
    });
  };

  return {
    preview: (request, timeoutMs) => run({ kind: 'preview', ...request }, timeoutMs),
    apply: (request, timeoutMs) => run({ kind: 'apply', ...request }, timeoutMs),
    dispose,
  };
}
