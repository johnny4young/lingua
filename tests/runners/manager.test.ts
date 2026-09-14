import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock esbuild-wasm to avoid jsdom TextEncoder incompatibility
vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

// Count constructions so the registry tests can prove a runner is only built
// once a run resolves it. Each subclass behaves exactly like the real runner.
const constructed = vi.hoisted(() => ({
  python: 0,
  browserPreview: 0,
  node: 0,
  deno: 0,
  bun: 0,
}));

vi.mock('@/runners/python', async importOriginal => {
  const actual = await importOriginal<typeof import('@/runners/python')>();
  class PythonRunner extends actual.PythonRunner {
    constructor() {
      super();
      constructed.python += 1;
    }
  }
  return { ...actual, PythonRunner };
});

vi.mock('@/runners/browserPreview', async importOriginal => {
  const actual = await importOriginal<typeof import('@/runners/browserPreview')>();
  class BrowserPreviewRunner extends actual.BrowserPreviewRunner {
    constructor() {
      super();
      constructed.browserPreview += 1;
    }
  }
  return { ...actual, BrowserPreviewRunner };
});

vi.mock('@/runners/nodeRunner', async importOriginal => {
  const actual = await importOriginal<typeof import('@/runners/nodeRunner')>();
  class NodeRunner extends actual.NodeRunner {
    constructor() {
      super();
      constructed.node += 1;
    }
  }
  return { ...actual, NodeRunner };
});

vi.mock('@/runners/altJsRunner', async importOriginal => {
  const actual = await importOriginal<typeof import('@/runners/altJsRunner')>();
  class AltJsRunner extends actual.AltJsRunner {
    constructor(id: 'deno' | 'bun') {
      super(id);
      constructed[id] += 1;
    }
  }
  return { ...actual, AltJsRunner };
});

// Mock window.lingua for Go and Rust runner (IPC calls). No Node, Deno or Bun
// bridge by default, which is how the web build looks to the manager.
const baseLingua = {
  platform: 'darwin',
  go: {
    detect: vi.fn().mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' }),
    compile: vi.fn().mockResolvedValue({ success: false, error: 'mock compile' }),
  },
  rust: {
    detect: vi.fn().mockResolvedValue({ installed: true, version: 'rustc 1.75.0' }),
    run: vi.fn().mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0, executionTime: 0 }),
  },
};

Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    lingua: baseLingua,
  },
  writable: true,
});

import { RunnerManager } from '@/runners/manager';
import { AltJsRunner } from '@/runners/altJsRunner';
import { BrowserPreviewRunner } from '@/runners/browserPreview';
import { NodeRunner } from '@/runners/nodeRunner';
import { pluginRegistry, BasePluginRunner } from '@/plugins';
import type { ExecutionContext, ExecutionResult } from '@/types';

function installDesktopBridges(bridges: Partial<Record<'node' | 'deno' | 'bun', object>>): void {
  (window as unknown as { lingua: object }).lingua = { ...baseLingua, ...bridges };
}

function desktopBridge() {
  return { detect: vi.fn(), run: vi.fn(), stop: vi.fn() };
}

class SmokePluginRunner extends BasePluginRunner {
  id = 'lua';
  name = 'Lua';
  language = 'lua';
  extensions = ['.lua'];

  async execute(_code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    return {
      stdout: [{ type: 'log', args: ['plugin ok'] }],
      stderr: [],
      result: undefined,
      executionTime: 1,
    };
  }
}

class CountingPluginRunner extends BasePluginRunner {
  id = 'counting';
  name = 'Counting';
  language = 'counting';
  extensions = ['.count'];
  initCalls = 0;

  override async init(): Promise<void> {
    this.initCalls += 1;
    await super.init();
  }

  async execute(_code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    return {
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 1,
    };
  }
}

describe('RunnerManager', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    manager = new RunnerManager();
    pluginRegistry.unregister('lua-smoke');
    pluginRegistry.unregister('counting-smoke');
  });

  it('should support javascript, typescript, go, python, and rust', () => {
    expect(manager.isSupported('javascript')).toBe(true);
    expect(manager.isSupported('typescript')).toBe(true);
    expect(manager.isSupported('go')).toBe(true);
    expect(manager.isSupported('python')).toBe(true);
    expect(manager.isSupported('rust')).toBe(true);
    // implementation — Ruby joined the built-in factories.
    expect(manager.isSupported('ruby')).toBe(true);
  });

  it('should list all 6 supported languages', () => {
    const supported = manager.getSupportedLanguages();
    expect(supported).toContain('javascript');
    expect(supported).toContain('typescript');
    expect(supported).toContain('go');
    expect(supported).toContain('python');
    expect(supported).toContain('rust');
    expect(supported).toContain('ruby');
    expect(supported).toHaveLength(6);
  });

  it('should get rust runner (initializes with detect)', async () => {
    const runner = await manager.getRunner('rust');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('rust');
    expect(runner?.language).toBe('rust');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get javascript runner', async () => {
    const runner = await manager.getRunner('javascript');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('javascript');
    expect(runner?.language).toBe('javascript');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get go runner (initializes with detect)', async () => {
    const runner = await manager.getRunner('go');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('go');
    expect(runner?.language).toBe('go');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get python runner', async () => {
    const runner = await manager.getRunner('python');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('python');
    expect(runner?.language).toBe('python');
    expect(runner?.isReady()).toBe(true);
  });

  it('should stop all runners without error', () => {
    expect(() => manager.stopAll()).not.toThrow();
  });

  it('should stop a specific language runner without error', () => {
    expect(() => manager.stop('javascript')).not.toThrow();
    expect(() => manager.stop('go')).not.toThrow();
    expect(() => manager.stop('python')).not.toThrow();
    expect(() => manager.stop('rust')).not.toThrow(); // no-op (native runner)
  });

  it('implementation: does not resolve lua from LANGUAGE_PACKS alone — plugin fallback required', () => {
    // Lua ships as a first-class LanguagePack entry  but its
    // runner is plugin-sourced. Without a plugin registration, the
    // manager must NOT claim support, which proves the pack walk is
    // additive — it did not secretly replace the pluginRegistry path.
    expect(manager.isSupported('lua')).toBe(false);
    expect(manager.getSupportedLanguages()).not.toContain('lua');
  });

  it('should execute a registered plugin runner', async () => {
    pluginRegistry.register({
      id: 'lua-smoke',
      name: 'Lua',
      version: '0.1.0',
      language: 'lua',
      extensions: ['.lua'],
      async createRunner() {
        return new SmokePluginRunner();
      },
    });

    expect(manager.isSupported('lua')).toBe(true);

    const result = await manager.execute('lua', 'print("hi")');
    expect(result.stdout[0]?.args[0]).toBe('plugin ok');
  });

  it('prepares a plugin runner only once after it becomes ready', async () => {
    const countingRunner = new CountingPluginRunner();

    pluginRegistry.register({
      id: 'counting-smoke',
      name: 'Counting',
      version: '0.1.0',
      language: 'counting',
      extensions: ['.count'],
      async createRunner() {
        return countingRunner;
      },
    });

    expect(manager.needsInitialization('counting')).toBe(true);

    const firstPreparation = await manager.prepareRunner('counting');
    expect(firstPreparation.runner).toBe(countingRunner);
    expect(firstPreparation.initialized).toBe(true);
    expect(countingRunner.initCalls).toBe(1);

    const secondPreparation = await manager.prepareRunner('counting');
    expect(secondPreparation.runner).toBe(countingRunner);
    expect(secondPreparation.initialized).toBe(false);
    expect(countingRunner.initCalls).toBe(1);
  });
});

describe('RunnerManager registry', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    for (const key of Object.keys(constructed) as Array<keyof typeof constructed>) {
      constructed[key] = 0;
    }
    installDesktopBridges({});
    pluginRegistry.unregister('lua-smoke');
    pluginRegistry.unregister('counting-smoke');
    manager = new RunnerManager();
  });

  it('constructs no runner until a run resolves one', () => {
    expect(manager.isSupported('python')).toBe(true);
    expect(manager.getSupportedLanguages()).toHaveLength(6);
    manager.stop('python');
    manager.stop('javascript', 'browser-preview');
    manager.stopAll();

    expect(constructed).toEqual({ python: 0, browserPreview: 0, node: 0, deno: 0, bun: 0 });
  });

  it('constructs a built-in language runner on first resolve and reuses it', async () => {
    const python = manager.getPythonRunner();

    expect(python).not.toBeNull();
    expect(await manager.getRunner('python')).toBe(python);
    expect(manager.getPythonRunner()).toBe(python);
    expect(constructed.python).toBe(1);
  });

  it('constructs a runtime-mode runner on first resolve and reuses it', async () => {
    const first = await manager.prepareRunner('javascript', 'browser-preview');
    const second = await manager.prepareRunner('typescript', 'browser-preview');

    expect(first.runner).toBeInstanceOf(BrowserPreviewRunner);
    expect(first.initialized).toBe(true);
    expect(second.runner).toBe(first.runner);
    expect(second.initialized).toBe(false);
    expect(constructed).toEqual({ python: 0, browserPreview: 1, node: 0, deno: 0, bun: 0 });
  });

  it.each([
    ['node', 'Node runtime mode is only available in the desktop build.'],
    ['deno', 'Deno (desktop) runtime mode is only available in the desktop build.'],
    ['bun', 'Bun (desktop) runtime mode is only available in the desktop build.'],
  ] as const)(
    'reports %s as desktop-only without constructing its runner when the bridge is missing',
    async (mode, message) => {
      expect(manager.needsInitialization('javascript', mode)).toBe(false);

      const prepared = await manager.prepareRunner('javascript', mode);
      expect(prepared.initialized).toBe(false);
      expect(prepared.unavailable).toBe('desktop-only');
      await expect(prepared.runner?.execute('console.log(1)')).resolves.toEqual({
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: { message },
        kind: 'error',
      });

      // Notebooks, recipes and benchmarks run through execute() and report the same error.
      await expect(
        manager.execute('typescript', 'console.log(1)', undefined, mode)
      ).resolves.toMatchObject({ kind: 'error', error: { message } });
      expect(constructed[mode]).toBe(0);
    }
  );

  it('constructs the desktop runner once its bridge exists', async () => {
    installDesktopBridges({ deno: desktopBridge() });

    const deno = await manager.prepareRunner('typescript', 'deno');
    expect(deno.unavailable).toBeUndefined();
    expect(deno.runner).toBeInstanceOf(AltJsRunner);
    expect(deno.runner?.id).toBe('deno');
    expect(deno.initialized).toBe(true);
    expect(constructed.deno).toBe(1);

    installDesktopBridges({ node: desktopBridge() });
    expect(manager.needsInitialization('javascript', 'node')).toBe(true);
    const node = await manager.getRunner('javascript', 'node');
    expect(node).toBeInstanceOf(NodeRunner);
    expect(constructed.node).toBe(1);
  });

  it('keeps worker mode, languages without runtime modes, and plugins on the language path', async () => {
    installDesktopBridges({ node: desktopBridge() });

    expect((await manager.prepareRunner('javascript', 'worker')).runner?.id).toBe('javascript');
    // Python owns no runtime-mode surface, so a stray mode never reroutes it.
    expect(manager.needsInitialization('python', 'browser-preview')).toBe(true);
    expect(constructed).toMatchObject({ python: 1, browserPreview: 0 });

    pluginRegistry.register({
      id: 'lua-smoke',
      name: 'Lua',
      version: '0.1.0',
      language: 'lua',
      extensions: ['.lua'],
      async createRunner() {
        return new SmokePluginRunner();
      },
    });
    const lua = await manager.execute('lua', 'print("hi")', undefined, 'node');
    expect(lua.stdout[0]?.args[0]).toBe('plugin ok');
    expect(constructed.node).toBe(0);
  });

  it('stops only runners that were constructed', async () => {
    const { runner } = await manager.prepareRunner('javascript', 'browser-preview');
    const stop = vi.spyOn(runner!, 'stop');

    manager.stop('javascript', 'node');
    manager.stop('go');
    expect(stop).not.toHaveBeenCalled();

    manager.stop('typescript', 'browser-preview');
    expect(stop).toHaveBeenCalledTimes(1);
    manager.stopAll();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(constructed).toEqual({ python: 0, browserPreview: 1, node: 0, deno: 0, bun: 0 });
  });
});
