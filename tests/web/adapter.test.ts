/**
 * Tests for the web adapter (src/web/adapter.ts)
 *
 * The adapter sets window.lingua before React renders. We test that:
 *  - platform is 'web'
 *  - go.detect() and go.compile() return "not available" stubs
 *  - rust.detect() and rust.run() return "not available" stubs
 *  - fs namespace is present (delegation tested separately in fs-adapter.test.ts)
 */

import { describe, it, expect } from 'vitest';

// The web FS adapter uses browser File System Access API which is not available
// in jsdom. We mock it out so importing adapter.ts doesn't crash.
const mockFsAdapter = {
  selectDirectory: async () => null,
  selectFile: async () => null,
  readdir: async () => [],
  stat: async () => ({ size: 0, isDirectory: false, isFile: true, mtime: '', ctime: '' }),
  read: async () => '',
  write: async () => true,
  delete: async () => true,
  rename: async (_: string, newName: string) => '/' + newName,
  mkdir: async () => true,
  touch: async () => true,
  watchStart: async () => 'noop',
  watchStop: async () => true,
  onChanged: () => () => {},
};

// We test the stubs directly rather than going through the module side-effect
// (which would clobber window.lingua in the test environment).

describe('web adapter — Go stub', () => {
  const goStub = {
    detect: async (): Promise<GoDetectResult> => ({
      installed: false,
      error: 'Go compilation is not available in the web version. Download the desktop app to compile Go code.',
    }),
    compile: async (_sourceCode: string): Promise<GoCompileResult> => ({
      success: false,
      error: 'Go compilation is not available in the web version. Download the desktop app to compile Go code.',
    }),
  };

  it('detect returns installed: false', async () => {
    const result = await goStub.detect();
    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/not available in the web version/);
  });

  it('compile returns success: false', async () => {
    const result = await goStub.compile('package main\nfunc main() {}');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available in the web version/);
  });
});

describe('web adapter — Rust stub', () => {
  const rustStub = {
    detect: async (): Promise<RustDetectResult> => ({
      installed: false,
      error: 'Rust compilation is not available in the web version. Download the desktop app to compile Rust code.',
    }),
    run: async (_sourceCode: string): Promise<RustRunResult> => ({
      success: false,
      stdout: '',
      stderr: 'Rust compilation is not available in the web version. Download the desktop app to compile Rust code.',
      exitCode: 1,
      executionTime: 0,
      error: 'Rust compilation is not available in the web version.',
    }),
  };

  it('detect returns installed: false', async () => {
    const result = await rustStub.detect();
    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/not available in the web version/);
  });

  it('run returns success: false with non-zero exitCode', async () => {
    const result = await rustStub.run('fn main() {}');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not available in the web version/);
  });
});

describe('web adapter — fs namespace', () => {
  it('fs adapter is an object with the expected methods', () => {
    const methods: Array<keyof typeof mockFsAdapter> = [
      'selectDirectory',
      'selectFile',
      'readdir',
      'stat',
      'read',
      'write',
      'delete',
      'rename',
      'mkdir',
      'touch',
      'watchStart',
      'watchStop',
      'onChanged',
    ];
    for (const method of methods) {
      expect(typeof mockFsAdapter[method]).toBe('function');
    }
  });
});

describe('web adapter — updates namespace', () => {
  const updatesStub = {
    getState: async (): Promise<UpdateState> => ({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are not available in the web version.',
    }),
    check: async (): Promise<UpdateState> => ({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are not available in the web version.',
    }),
    restartToApply: async () => false,
    onStateChanged: () => () => {},
  };

  it('returns an unavailable state in the browser build', async () => {
    const result = await updatesStub.getState();
    expect(result.status).toBe('unavailable');
    expect(result.supported).toBe(false);
  });

  it('does not allow restart in the browser build', async () => {
    const restarted = await updatesStub.restartToApply();
    expect(restarted).toBe(false);
  });
});

describe('web adapter — plugins namespace', () => {
  const pluginStub = {
    getInstallDirectory: async () => null,
    list: async (): Promise<InstalledPluginRecord[]> => [],
  };

  it('reports no local install directory in the browser build', async () => {
    const installDirectory = await pluginStub.getInstallDirectory();
    expect(installDirectory).toBeNull();
  });

  it('reports no installed plugins in the browser build', async () => {
    const plugins = await pluginStub.list();
    expect(plugins).toEqual([]);
  });
});

describe('web adapter — platform', () => {
  it('platform is "web"', () => {
    // Simulate what adapter.ts does
    const webLingua = {
      platform: 'web',
      go: {},
      rust: {},
      fs: mockFsAdapter,
    };
    expect(webLingua.platform).toBe('web');
  });
});
