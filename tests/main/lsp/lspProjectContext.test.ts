import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), resolve: vi.fn(), request: vi.fn(), dispose: vi.fn(), roots: [] as (string | undefined)[], navigation: true }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(name, handler), on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../../../src/main/ipc/projectCapabilities', () => ({ resolveCapabilityPath: mocks.resolve }));
vi.mock('node:fs/promises', () => ({ stat: async () => ({ isDirectory: () => true }) }));
class Launcher {
  constructor(options: { workspaceRoot?: string }) { mocks.roots.push(options.workspaceRoot); }
  status = () => ({ kind: 'running', version: 'fixture', navigation: { definition: mocks.navigation, references: mocks.navigation } });
  start = async () => this.status();
  sendRequest = mocks.request;
  sendNotification = vi.fn();
  dispose = mocks.dispose;
}
vi.mock('../../../src/main/lsp/goplsLauncher', () => ({ GoplsLauncher: Launcher }));
vi.mock('../../../src/main/lsp/rustAnalyzerLauncher', () => ({ RustAnalyzerLauncher: Launcher }));
let bridge: typeof import('../../../src/main/ipc/lsp');
async function invoke(language: string, method: string, ...args: unknown[]) { return await mocks.handlers.get(`lsp:${language}:${method}`)!({}, ...args); }
const authorized = (rootId: string) => ({ ok: true, absolutePath: `/project/${rootId}` });
beforeEach(async () => {
  vi.resetModules(); mocks.handlers.clear(); mocks.resolve.mockReset(); mocks.request.mockReset(); mocks.dispose.mockReset(); mocks.roots.length = 0; mocks.navigation = true;
  mocks.resolve.mockImplementation(async rootId => authorized(rootId));
  bridge = await import('../../../src/main/ipc/lsp'); bridge.registerLspHandlers();
});
afterEach(() => bridge.disposeLspBridge());
describe.each(['go', 'rust'])('authorized %s project lifecycle', language => {
  it('recreates and restarts only with the resolved authorized root', async () => {
    await invoke(language, 'start', 'a'); await invoke(language, 'start', 'b'); await invoke(language, 'restart');
    expect(mocks.roots).toEqual(['/project/a', '/project/b', '/project/b']); expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });
  it('rejects absent server capabilities before sending', async () => {
    mocks.navigation = false; await invoke(language, 'start', 'a');
    expect(await invoke(language, 'request', 'textDocument/definition', {})).toMatchObject({ ok: false, reason: 'unsupported-method' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('discards old responses after changing roots', async () => {
    await invoke(language, 'start', 'a'); let finish!: (value: unknown) => void;
    mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = invoke(language, 'request', 'textDocument/definition', {});
    await invoke(language, 'start', 'b'); finish([]);
    expect(await pending).toMatchObject({ ok: false, reason: 'request-failed' });
  });
  it('stops an existing same-root server when its grant is revoked', async () => {
    await invoke(language, 'start', 'a'); mocks.resolve.mockResolvedValue({ ok: false });
    expect(await invoke(language, 'start', 'a')).toMatchObject({ kind: 'startup-failed' });
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not restart a pending project after explicit stop', async () => {
    let finish!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = invoke(language, 'start', 'a'); await invoke(language, 'stop'); finish(authorized('a'));
    expect(await pending).toMatchObject({ kind: 'startup-failed' }); expect(mocks.roots).toEqual([]);
  });
  it('restarts the pending requested root rather than the previous one', async () => {
    await invoke(language, 'start', 'a');
    let finish!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = invoke(language, 'start', 'b'); const restarted = invoke(language, 'restart'); finish(authorized('b'));
    await pending; await restarted;
    expect(mocks.roots).toEqual(['/project/a', '/project/b']);
  });
  it('does not let an older pending root override a newer one', async () => {
    let finish!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = invoke(language, 'start', 'a'); await invoke(language, 'start', 'b'); finish(authorized('a'));
    expect(await pending).toMatchObject({ kind: 'startup-failed' }); expect(mocks.roots).toEqual(['/project/b']);
  });
});
