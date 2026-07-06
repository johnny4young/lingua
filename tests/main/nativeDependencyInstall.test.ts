import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installNativeDependencies } from '../../src/main/nativeDependencyInstall';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

describe('installNativeDependencies', () => {
  it('spawns the planned command for Go and maps a clean exit to success', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const promise = installNativeDependencies({
      language: 'go',
      specifiers: ['github.com/gin-gonic/gin'],
      cwd: '/proj',
      skipManifestCheck: true,
      spawnImpl,
    });
    // spawn called with go get + the specifier, no shell.
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [binary, args, opts] = (spawnImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(binary).toBe('go');
    expect(args).toEqual(['get', '--', 'github.com/gin-gonic/gin']);
    expect((opts as { cwd: string }).cwd).toBe('/proj');
    child.stdout.emit('data', Buffer.from('go: downloading\n'));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ status: 'success', exitCode: 0 });
  });

  it('plans cargo add for Rust and bundle add for Ruby', async () => {
    for (const [language, binary, specifier, expected] of [
      ['rust', 'cargo', 'serde', ['add', '--', 'serde']],
      ['ruby', 'bundle', 'rails', ['add', '--', 'rails']],
    ] as const) {
      const child = fakeChild();
      const spawnImpl = vi.fn(() => child) as never;
      const promise = installNativeDependencies({
        language,
        specifiers: [specifier],
        cwd: '/p',
        skipManifestCheck: true,
        spawnImpl,
      });
      const [gotBinary, gotArgs] = (spawnImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
      expect(gotBinary).toBe(binary);
      expect(gotArgs).toEqual(expected);
      child.emit('close', 0);
      await promise;
    }
  });

  it('refuses invalid specifiers without spawning', async () => {
    const spawnImpl = vi.fn() as never;
    const res = await installNativeDependencies({
      language: 'go',
      specifiers: ['bad; rm -rf /'],
      cwd: '/p',
      skipManifestCheck: true,
      spawnImpl,
    });
    expect(res.status).toBe('invalid-specifiers');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('refuses when the manifest is missing (real fs check)', async () => {
    const spawnImpl = vi.fn() as never;
    const res = await installNativeDependencies({
      language: 'rust',
      specifiers: ['serde'],
      cwd: '/nonexistent-dir-xyz',
      spawnImpl,
    });
    expect(res.status).toBe('missing-manifest');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('maps a non-zero exit to error with stderr', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const promise = installNativeDependencies({
      language: 'go',
      specifiers: ['github.com/x/y'],
      cwd: '/p',
      skipManifestCheck: true,
      spawnImpl,
    });
    child.stderr.emit('data', Buffer.from('go: module not found\n'));
    child.emit('close', 1);
    const res = await promise;
    expect(res.status).toBe('error');
    expect(res.error).toContain('module not found');
  });

  it('maps ENOENT to missing-binary', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const promise = installNativeDependencies({
      language: 'ruby',
      specifiers: ['rails'],
      cwd: '/p',
      skipManifestCheck: true,
      spawnImpl,
    });
    child.emit('error', new Error('spawn bundle ENOENT'));
    const res = await promise;
    expect(res.status).toBe('missing-binary');
  });
});
