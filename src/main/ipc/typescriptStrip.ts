import { Worker } from 'node:worker_threads';
import { typedHandle } from './typedHandle';

const MAX_STRIP_SOURCE_LENGTH = 200_000;
// swc can backtrack for seconds on a few hundred characters of nested arrow
// functions. Thread startup gets its own, looser budget.
const STRIP_TIMEOUT_MS = 750;
const STARTUP_TIMEOUT_MS = 5_000;

// Plain CommonJS so bundling cannot rename what the thread requires. Syntax
// Node refuses or the worker's async body cannot compile returns null; any
// other error (a wasm trap, a stack overflow) asks for a fresh thread.
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const { stripTypeScriptTypes } = require('node:module');
const { Script } = require('node:vm');
const expected = /^ERR_(UNSUPPORTED|INVALID)_TYPESCRIPT_SYNTAX$/;
// Node blanks a type-only statement together with its own semicolon, which
// can join the statements on either side, as in a no-semicolon ;(iife)().
const joinsStatements = (code, js) => {
  for (let i = code.indexOf(';'); i !== -1; i = code.indexOf(';', i + 1)) {
    if (js[i] === ';') continue;
    let next = i + 1;
    while (/\\s/.test(js[next] || '')) next++;
    if (!'([+-/\\x60'.includes(js[next] || ' ')) continue;
    let prev = i - 1;
    while (/\\s/.test(js[prev] || '')) prev--;
    if (prev >= 0 && js[prev] !== ';' && js[prev] !== '{') return true;
  }
  return false;
};
parentPort.on('message', ({ id, code }) => {
  try {
    const js = stripTypeScriptTypes(code, { mode: 'strip' });
    if (joinsStatements(code, js)) return parentPort.postMessage({ id, js: null });
    new Script('(async function () {\\n' + js + '\\n})');
    parentPort.postMessage({ id, js });
  } catch (error) {
    const broken = !(error instanceof SyntaxError) && !expected.test(error && error.code);
    parentPort.postMessage({ id, js: null, broken });
  }
});
`;

interface Waiting {
  readonly code: string;
  readonly resolve: (js: string | null) => void;
}

interface Running {
  readonly id: number;
  readonly resolve: (js: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Erasable TypeScript as worker-ready JavaScript with every line and column
 * unchanged, or null when esbuild has to transform it. One request runs at a
 * time on a thread main can kill; a newer request replaces one still waiting.
 */
export class TypeScriptStripper {
  private worker: Worker | null = null;
  private online = false;
  private running: Running | null = null;
  private waiting: Waiting | null = null;
  private nextId = 0;

  constructor(
    private readonly timeoutMs = STRIP_TIMEOUT_MS,
    private readonly createWorker = () => new Worker(WORKER_SOURCE, { eval: true })
  ) {}

  strip(code: unknown): Promise<string | null> {
    if (typeof code !== 'string' || code.length > MAX_STRIP_SOURCE_LENGTH) {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      this.waiting?.resolve(null);
      this.waiting = { code, resolve };
      this.pump();
    });
  }

  dispose(): void {
    this.waiting?.resolve(null);
    this.waiting = null;
    this.replaceWorker();
  }

  private pump(): void {
    if (this.running || !this.waiting) return;
    const { code, resolve } = this.waiting;
    this.waiting = null;
    const id = ++this.nextId;
    const timer = this.startTimer(this.online ? this.timeoutMs : STARTUP_TIMEOUT_MS);
    this.running = { id, resolve, timer };
    try {
      this.ensureWorker().postMessage({ id, code });
    } catch {
      this.replaceWorker();
    }
  }

  private startTimer(ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.replaceWorker(), ms);
    timer.unref();
    return timer;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.unref();
    worker.once('online', () => {
      if (this.worker !== worker) return;
      this.online = true;
      if (!this.running) return;
      clearTimeout(this.running.timer);
      this.running.timer = this.startTimer(this.timeoutMs);
    });
    worker.on('message', (reply: { id?: unknown; js?: unknown; broken?: unknown }) => {
      // A replaced thread can still deliver a queued reply.
      if (this.worker !== worker || reply.id !== this.running?.id) return;
      if (reply.broken === true) this.replaceWorker();
      else this.settle(typeof reply.js === 'string' ? reply.js : null);
    });
    worker.on('error', () => {
      if (this.worker === worker) this.replaceWorker();
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.replaceWorker();
    });
    this.worker = worker;
    return worker;
  }

  /** Kills the thread, fails the running request, and lets the next one start a fresh thread. */
  private replaceWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.online = false;
    void worker?.terminate();
    this.settle(null);
  }

  private settle(js: string | null): void {
    const running = this.running;
    if (!running) return;
    clearTimeout(running.timer);
    this.running = null;
    running.resolve(js);
    this.pump();
  }
}

export function registerTypeScriptHandlers(): void {
  const stripper = new TypeScriptStripper();
  typedHandle('typescript:strip', (_event, code: unknown) => stripper.strip(code));
}
