import vm from 'node:vm';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

/** In-memory origin private file system with the subset of the API the migration uses. */
export class FakeFileHandle {
  readonly kind = 'file';
  parent: FakeDirectoryHandle | null = null;
  name = '';
  constructor(public data: Uint8Array = new Uint8Array()) {}
  /** Replaces a file already at `name`, as Chromium's origin private file system does. */
  async move(name: string) {
    if (!this.parent) throw notFound();
    this.parent.children.delete(this.name);
    this.parent.children.set(name, this);
    this.name = name;
  }
  async getFile() {
    return new Blob([this.data.slice()]);
  }
  async createWritable(_options?: { keepExistingData?: boolean }) {
    const chunks: Uint8Array[] = [];
    return {
      write: async (bytes: Uint8Array) => {
        chunks.push(new Uint8Array(bytes));
      },
      close: async () => {
        this.data = new Uint8Array(Buffer.concat(chunks));
      },
      abort: async () => {},
    };
  }
}

const notFound = () => new DOMException('missing', 'NotFoundError');

export class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeDirectoryHandle | FakeFileHandle>();
  async *entries() {
    yield* this.children.entries();
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    let child = this.children.get(name);
    if (!child && options.create) this.children.set(name, (child = new FakeDirectoryHandle()));
    if (!child) throw notFound();
    if (child.kind !== 'directory') throw new DOMException('file', 'TypeMismatchError');
    return child;
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    let child = this.children.get(name);
    if (!child && options.create) this.adopt(name, (child = new FakeFileHandle()));
    if (!child) throw notFound();
    if (child.kind !== 'file') throw new DOMException('directory', 'TypeMismatchError');
    return child;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw notFound();
  }
  private adopt(name: string, file: FakeFileHandle) {
    file.parent = this;
    file.name = name;
    this.children.set(name, file);
  }
  file(path: string): FakeFileHandle | undefined {
    const [head = '', ...rest] = path.split('/');
    const child = this.children.get(head);
    if (rest.length === 0) return child?.kind === 'file' ? child : undefined;
    return child?.kind === 'directory' ? child.file(rest.join('/')) : undefined;
  }
  put(path: string, data: Uint8Array): void {
    const [head = '', ...rest] = path.split('/');
    if (rest.length === 0) {
      this.adopt(head, new FakeFileHandle(data));
      return;
    }
    let child = this.children.get(head);
    if (child?.kind !== 'directory') this.children.set(head, (child = new FakeDirectoryHandle()));
    child.put(rest.join('/'), data);
  }
}

export class FakeStorage {
  readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

/** One origin: its storage plus an isolated realm that runs main's scripts against it. */
export class FakeOrigin {
  readonly localStorage = new FakeStorage();
  readonly opfs = new FakeDirectoryHandle();
  readonly context = vm.createContext({
    localStorage: this.localStorage,
    navigator: { storage: { getDirectory: async () => this.opfs } },
    atob,
  });
  scripts = 0;
  run(code: string): Promise<unknown> {
    this.scripts += 1;
    return Promise.resolve(vm.runInContext(code, this.context));
  }
}

export interface FakePagesOptions {
  legacy: FakeOrigin;
  target: FakeOrigin;
  /** Rejects or stalls a load, by kind. */
  load?: (kind: 'legacy' | 'target') => Promise<void>;
}

/** A BrowserWindow stand-in: loadFile reaches the legacy origin, loadURL the target one. */
export function fakeWindowClass(options: FakePagesOptions) {
  const created: FakeWindow[] = [];
  class FakeWindow {
    origin: FakeOrigin | null = null;
    destroyed = false;
    readonly handlers = new Map<string, (event: { preventDefault: () => void }) => void>();
    openHandler: (() => { action: string }) | null = null;
    readonly webContents = {
      setWindowOpenHandler: (handler: () => { action: string }) => {
        this.openHandler = handler;
      },
      on: (name: string, handler: (event: { preventDefault: () => void }) => void) => {
        this.handlers.set(name, handler);
      },
      executeJavaScript: (code: string) => {
        if (this.destroyed || !this.origin) return Promise.reject(new Error('no page'));
        // Like Electron, a page-side rejection reaches main without its name.
        return this.origin.run(code).catch(() => Promise.reject({}));
      },
    };
    constructor(readonly options: BrowserWindowConstructorOptions) {
      created.push(this);
    }
    async loadFile(_file: string) {
      await options.load?.('legacy');
      this.origin = options.legacy;
    }
    async loadURL(_url: string) {
      await options.load?.('target');
      this.origin = options.target;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    Window: FakeWindow as unknown as new (options: BrowserWindowConstructorOptions) => BrowserWindow,
    created,
  };
}
