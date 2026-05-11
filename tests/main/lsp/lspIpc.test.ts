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

vi.mock('../../../src/main/lsp/rustAnalyzerLauncher', () => ({
  RustAnalyzerLauncher: vi.fn().mockImplementation(() => ({
    start: vi.fn(async () => ({ kind: 'running', version: 'rust-analyzer test' })),
    restart: vi.fn(async () => ({ kind: 'running', version: 'rust-analyzer test' })),
    stop: vi.fn(),
    status: vi.fn(() => ({ kind: 'running', version: 'rust-analyzer test' })),
    sendRequest: sendRequestMock,
    sendNotification: sendNotificationMock,
    dispose: disposeMock,
  })),
}));

beforeEach(() => {
  vi.resetModules();
  handleMock.mockReset();
  onMock.mockReset();
  sendRequestMock.mockReset();
  sendNotificationMock.mockReset();
  disposeMock.mockReset();
});

async function loadHandlers() {
  const module = await import('../../../src/main/ipc/lsp');
  module.registerLspHandlers();

  const start = handleMock.mock.calls.find(([channel]) => channel === 'lsp:rust:start')?.[1];
  const request = handleMock.mock.calls.find(
    ([channel]) => channel === 'lsp:rust:request'
  )?.[1];
  const notify = onMock.mock.calls.find(([channel]) => channel === 'lsp:rust:notify')?.[1];

  if (!start || !request || !notify) {
    throw new Error('missing registered LSP IPC handlers');
  }

  await start({});
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
    ).resolves.toEqual({ ok: true, result: { items: [] } });

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
    ).resolves.toEqual({ ok: false, error: 'Unsupported rust-analyzer request' });

    expect(sendRequestMock).not.toHaveBeenCalled();
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
