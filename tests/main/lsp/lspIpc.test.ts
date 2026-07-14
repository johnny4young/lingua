import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const onMock = vi.fn();
const sendRequestMock = vi.fn();
const sendNotificationMock = vi.fn();
const disposeMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: onMock,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Vitest 4 made arrow-fn `vi.fn().mockImplementation(...)` non-newable;
// the production code does `new RustAnalyzerLauncher(...)` so the mock
// must be a real constructor. Use a class with the same surface.
class RustAnalyzerLauncherMock {
  start = vi.fn(async () => ({ kind: 'running', version: 'rust-analyzer test' }));
  restart = vi.fn(async () => ({ kind: 'running', version: 'rust-analyzer test' }));
  stop = vi.fn();
  status = vi.fn(() => ({ kind: 'running', version: 'rust-analyzer test' }));
  sendRequest = sendRequestMock;
  sendNotification = sendNotificationMock;
  dispose = disposeMock;
}

vi.mock('../../../src/main/lsp/rustAnalyzerLauncher', () => ({
  RustAnalyzerLauncher: RustAnalyzerLauncherMock,
}));

class GoplsLauncherMock {
  start = vi.fn(async () => ({ kind: 'running', version: 'gopls test' }));
  restart = vi.fn(async () => ({ kind: 'running', version: 'gopls test' }));
  stop = vi.fn();
  status = vi.fn(() => ({ kind: 'running', version: 'gopls test' }));
  sendRequest = sendRequestMock;
  sendNotification = sendNotificationMock;
  dispose = disposeMock;
}

vi.mock('../../../src/main/lsp/goplsLauncher', () => ({
  GoplsLauncher: GoplsLauncherMock,
}));

beforeEach(() => {
  vi.resetModules();
  handleMock.mockReset();
  onMock.mockReset();
  sendRequestMock.mockReset();
  sendNotificationMock.mockReset();
  disposeMock.mockReset();
});

async function loadHandlers(language: 'rust' | 'go' = 'rust', startLauncher = true) {
  const module = await import('../../../src/main/ipc/lsp');
  module.registerLspHandlers();

  const start = handleMock.mock.calls.find(([channel]) => channel === `lsp:${language}:start`)?.[1];
  const request = handleMock.mock.calls.find(
    ([channel]) => channel === `lsp:${language}:request`
  )?.[1];
  const notify = onMock.mock.calls.find(
    ([channel]) => channel === `lsp:${language}:notify`
  )?.[1];

  if (!start || !request || !notify) {
    throw new Error('missing registered LSP IPC handlers');
  }

  if (startLauncher) await start({});
  return { request, notify };
}

describe('registerLspHandlers', () => {
  it('only forwards supported Rust LSP requests', async () => {
    sendRequestMock.mockResolvedValue({ items: [] });
    const { request } = await loadHandlers();

    await expect(
      request({}, 'textDocument/completion', {
        textDocument: { uri: 'file:///src/main.rs' },
        position: { line: 0, character: 1 },
      })
    ).resolves.toEqual({ ok: true, data: { items: [] } });

    expect(sendRequestMock).toHaveBeenCalledWith('textDocument/completion', {
      textDocument: { uri: 'file:///src/main.rs' },
      position: { line: 0, character: 1 },
    });
  });

  it('rejects unsupported Rust LSP requests before they reach rust-analyzer', async () => {
    const { request } = await loadHandlers();

    await expect(
      request({}, 'workspace/executeCommand', {
        command: 'rust-analyzer.runSingle',
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'unsupported-method',
      message: 'Unsupported rust-analyzer request',
    });

    expect(sendRequestMock).not.toHaveBeenCalled();
  });

  it('maps an unavailable Go launcher to a not-started Result', async () => {
    const { request } = await loadHandlers('go', false);

    await expect(
      request({}, 'textDocument/hover', {
        textDocument: { uri: 'file:///src/main.go' },
        position: { line: 0, character: 1 },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-started',
      message: 'gopls launcher not started',
    });
  });

  it('maps LSP server rejections to a request-failed Result', async () => {
    sendRequestMock.mockRejectedValue(new Error('server closed'));
    const { request } = await loadHandlers('go');

    await expect(
      request({}, 'textDocument/signatureHelp', {
        textDocument: { uri: 'file:///src/main.go' },
        position: { line: 0, character: 1 },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'request-failed',
      message: 'server closed',
    });
  });

  it('drops unsupported Rust LSP notifications before they reach rust-analyzer', async () => {
    const { notify } = await loadHandlers();

    notify({}, 'workspace/didChangeConfiguration', { settings: { rust: {} } });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    notify({}, 'textDocument/didChange', {
      textDocument: { uri: 'file:///src/main.rs', version: 2 },
      contentChanges: [{ text: 'fn main() {}' }],
    });
    expect(sendNotificationMock).toHaveBeenCalledWith('textDocument/didChange', {
      textDocument: { uri: 'file:///src/main.rs', version: 2 },
      contentChanges: [{ text: 'fn main() {}' }],
    });
  });
});
