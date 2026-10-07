import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), listeners: new Map<string, (...args: unknown[]) => void>(), resolve: vi.fn(), request: vi.fn(), notify: vi.fn(), dispose: vi.fn(), sent: vi.fn(), roots: [] as (string | undefined)[], onNotification: [] as ((notification: unknown) => void)[], startGate: null as Promise<void> | null, navigation: true }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(name, handler), on: (name: string, listener: (...args: unknown[]) => void) => mocks.listeners.set(name, listener) }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.sent } }] } }));
vi.mock('../../../src/main/ipc/projectCapabilities', () => ({ resolveCapabilityPath: mocks.resolve }));
vi.mock('node:fs/promises', () => ({ stat: async () => ({ isDirectory: () => true }) }));
class Launcher {
  constructor(options: { workspaceRoot?: string; onNotification?: (notification: unknown) => void }) { mocks.roots.push(options.workspaceRoot); if (options.onNotification) mocks.onNotification.push(options.onNotification); }
  status = () => ({ kind: 'running', version: 'fixture', navigation: { definition: mocks.navigation, references: mocks.navigation } });
  start = async () => { if (mocks.startGate) await mocks.startGate; return this.status(); };
  sendRequest = mocks.request;
  sendNotification = mocks.notify;
  dispose = mocks.dispose;
}
vi.mock('../../../src/main/lsp/goplsLauncher', () => ({ GoplsLauncher: Launcher }));
vi.mock('../../../src/main/lsp/rustAnalyzerLauncher', async importOriginal => ({ pathToFileUri: (await importOriginal<typeof import('../../../src/main/lsp/rustAnalyzerLauncher')>()).pathToFileUri, RustAnalyzerLauncher: Launcher }));
let bridge: typeof import('../../../src/main/ipc/lsp');
async function invoke(language: string, method: string, ...args: unknown[]) { return await mocks.handlers.get(`lsp:${language}:${method}`)!({}, ...args); }
// The registered root is a symlink; the capability resolver also reports its realpath.
const authorized = (rootId: string) => ({ ok: true, absolutePath: `/real/${rootId}`, rootPath: `/project/${rootId}` });
const doc = (uri: string) => ({ textDocument: { uri }, position: { line: 0, character: 0 } });
function notify(language: string, method: string, params: unknown) { mocks.listeners.get(`lsp:${language}:notify`)!({}, method, params); }
beforeEach(async () => {
  vi.resetModules(); mocks.handlers.clear(); mocks.listeners.clear(); mocks.resolve.mockReset(); mocks.request.mockReset(); mocks.notify.mockReset(); mocks.dispose.mockReset(); mocks.sent.mockReset(); mocks.roots.length = 0; mocks.onNotification.length = 0; mocks.startGate = null; mocks.navigation = true;
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
    const pending = invoke(language, 'request', 'textDocument/definition', doc('file:///project/a/main.go'));
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
  it('starts the server at the authorized symlink root, not its realpath', async () => {
    await invoke(language, 'start', 'a');
    expect(mocks.roots).toEqual(['/project/a']);
  });
  it('forwards only documents under the authorized root or the unsaved scratch prefix', async () => {
    await invoke(language, 'start', 'a');
    notify(language, 'textDocument/didOpen', doc('file:///project/a/src/main.go'));
    notify(language, 'textDocument/didOpen', doc('file:///real/a/src/main.go'));
    notify(language, 'textDocument/didOpen', doc('file:///__lingua_unsaved__/tab-1/main.go'));
    notify(language, 'textDocument/didOpen', doc('file:///project/other/main.go'));
    notify(language, 'textDocument/didOpen', doc('file:///project/a/../b/main.go'));
    notify(language, 'textDocument/didChange', { textDocument: {} });
    notify(language, 'textDocument/didClose', doc('https://example.com/main.go'));
    expect(mocks.notify.mock.calls.map(([, params]) => (params as ReturnType<typeof doc>).textDocument.uri)).toEqual([
      'file:///project/a/src/main.go',
      'file:///real/a/src/main.go',
      'file:///__lingua_unsaved__/tab-1/main.go',
    ]);
    expect(await invoke(language, 'request', 'textDocument/hover', doc('file:///etc/passwd'))).toMatchObject({ ok: false, reason: 'request-failed' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rewrites realpath diagnostics URIs onto the authorized root', async () => {
    await invoke(language, 'start', 'a');
    mocks.onNotification.at(-1)!({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///real/a/src/main.go', diagnostics: [] } });
    expect(mocks.sent).toHaveBeenCalledWith(`lsp:${language}:notification`, { jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///project/a/src/main.go', diagnostics: [] } });
  });
  it('disposes a launcher stopped while its start is still pending', async () => {
    let release!: () => void;
    mocks.startGate = new Promise(resolve => { release = resolve; });
    const pending = invoke(language, 'start', 'a');
    await vi.waitFor(() => expect(mocks.roots).toEqual(['/project/a']));
    await invoke(language, 'stop'); release(); await pending;
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    mocks.startGate = null; await invoke(language, 'start', 'a');
    expect(mocks.roots).toEqual(['/project/a', '/project/a']);
  });
});
