import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { EditWithAiDialog } from '../../../src/renderer/components/AI/EditWithAiDialog';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';
import type { EditPreview } from '../../../src/renderer/runtime/aiEditPreview';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({ useEntitlement: () => entitled }));
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff-stub">
      {original}→{modified}
    </div>
  ),
}));

const editor = vi.hoisted(() => {
  const state = {
    uri: 'inmemory://tab-1',
    version: 3,
    executeEdits: vi.fn(),
    pushUndoStop: vi.fn(),
    focus: vi.fn(),
  };
  return state;
});

vi.mock('../../../src/renderer/runtime/editorAccess', () => ({
  getActiveEditor: () => ({
    getModel: () => ({
      uri: { toString: () => editor.uri },
      getVersionId: () => editor.version,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    }),
    executeEdits: editor.executeEdits,
    pushUndoStop: editor.pushUndoStop,
    focus: editor.focus,
  }),
  getActiveMonaco: () => ({
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number
      ) {}
    },
  }),
}));

const request = {
  code: 'const total = a + b;',
  start: 14,
  end: 19,
  language: 'javascript',
  filename: 'scratch.js',
  modelUri: 'inmemory://tab-1',
  versionId: 3,
};

const ran: EditPreview = {
  kind: 'ran',
  before: { error: 'a is not defined', stdout: '', executionTime: 4 },
  after: { error: null, stdout: '3', executionTime: 5 },
};

function configureAi(): void {
  useAiConfigStore.setState({ endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'sk-test', model: 'qwen3-coder' });
}

function renderDialog(overrides: { answer?: string; preview?: EditPreview; onClose?: () => void } = {}) {
  const runChatCompletionImpl = vi.fn().mockResolvedValue({ ok: true, content: overrides.answer ?? '```js\n1 + 2\n```' });
  const runPreviewImpl = vi.fn().mockResolvedValue(overrides.preview ?? ran);
  const onClose = overrides.onClose ?? vi.fn();
  render(<EditWithAiDialog request={request} onClose={onClose} runChatCompletionImpl={runChatCompletionImpl as never} runPreviewImpl={runPreviewImpl as never} />);
  return { runChatCompletionImpl, runPreviewImpl, onClose };
}

async function askFor(instruction = 'use literals') {
  fireEvent.change(screen.getByTestId('ai-edit-instruction'), { target: { value: instruction } });
  fireEvent.click(screen.getByTestId('ai-edit-send'));
  await waitFor(() => expect(screen.getByTestId('ai-edit-actions')).toBeTruthy());
}

describe('EditWithAiDialog', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    entitled = true;
    useAiConfigStore.getState().clear();
    editor.uri = 'inmemory://tab-1';
    editor.version = 3;
    editor.executeEdits.mockClear();
    editor.pushUndoStop.mockClear();
    localStorage.removeItem('lingua-ai-edit-preview-notice');
  });

  it('shows the upsell without the entitlement and sends nothing', () => {
    entitled = false;
    configureAi();
    renderDialog();
    expect(screen.getByText(i18next.t('ai.explainCode.upsell'))).toBeTruthy();
    expect((screen.getByTestId('ai-edit-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks to configure a provider first', () => {
    renderDialog();
    expect(screen.getByText(i18next.t('ai.explainCode.unconfigured'))).toBeTruthy();
    expect((screen.getByTestId('ai-edit-instruction') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows what would be sent and sends nothing until asked', () => {
    configureAi();
    const { runChatCompletionImpl } = renderDialog();
    fireEvent.change(screen.getByTestId('ai-edit-instruction'), { target: { value: 'use literals' } });
    const consent = screen.getByTestId('ai-edit-consent');
    expect(consent.textContent).toContain('<<<SELECTION>>>a + b<<<END SELECTION>>>');
    expect(consent.textContent).toContain('Change: use literals');
    expect(screen.getByTestId('ai-edit-provider').textContent).toContain('qwen3-coder');
    expect(runChatCompletionImpl).not.toHaveBeenCalled();
  });

  it('runs the proposal and shows the before and after with badges', async () => {
    configureAi();
    const { runPreviewImpl, runChatCompletionImpl } = renderDialog();
    await askFor();
    expect(runChatCompletionImpl.mock.calls[0]![0].messages[1].content).toContain('Change: use literals');
    expect(runPreviewImpl).toHaveBeenCalledWith('javascript', 'const total = a + b;', 'const total = 1 + 2;');
    expect(screen.getByTestId('ai-edit-now').textContent).toContain('a + b');
    expect(screen.getByTestId('ai-edit-now').textContent).toContain('a is not defined');
    expect(screen.getByTestId('ai-edit-preview').textContent).toContain('1 + 2');
    expect(screen.getByTestId('ai-edit-preview').textContent).toContain('3');
    const actions = screen.getByTestId('ai-edit-actions').textContent;
    expect(actions).toContain(i18next.t('ai.edit.fixed', { count: 1 }));
    expect(actions).toContain(i18next.t('ai.edit.newErrors', { count: 0 }));
    expect(actions).toContain(i18next.t('ai.edit.stdoutChanged'));
  });

  it('says why nothing ran for a language without a sandbox', async () => {
    configureAi();
    renderDialog({ preview: { kind: 'skipped' } });
    await askFor();
    expect(screen.getByTestId('ai-edit-skipped').textContent).toBe(i18next.t('ai.edit.skippedLanguage'));
    expect(screen.queryByTestId('ai-edit-notice')).toBeNull();
  });

  it('shows the sandbox notice once', async () => {
    configureAi();
    renderDialog();
    await askFor();
    fireEvent.click(screen.getByText(i18next.t('ai.edit.noticeOk')));
    expect(screen.queryByTestId('ai-edit-notice')).toBeNull();
    expect(localStorage.getItem('lingua-ai-edit-preview-notice')).toBe('1');
  });

  it('accepts as one undoable edit over the selection', async () => {
    configureAi();
    const { onClose } = renderDialog();
    await askFor();
    fireEvent.click(screen.getByTestId('ai-edit-accept'));
    expect(editor.executeEdits).toHaveBeenCalledWith('lingua.ai.edit', [
      { range: { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 20 }, text: '1 + 2', forceMoveMarkers: true },
    ]);
    expect(editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts with Cmd+Enter', async () => {
    configureAi();
    renderDialog();
    await askFor();
    fireEvent.keyDown(screen.getByTestId('ai-edit-accept'), { key: 'Enter', metaKey: true });
    expect(editor.executeEdits).toHaveBeenCalledTimes(1);
  });

  it('sends with Cmd+Enter while composing and keeps it from window shortcuts', async () => {
    configureAi();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    try {
      const { runChatCompletionImpl } = renderDialog();
      fireEvent.change(screen.getByTestId('ai-edit-instruction'), { target: { value: 'use literals' } });
      fireEvent.keyDown(screen.getByTestId('ai-edit-instruction'), { key: 'Enter', metaKey: true });
      await waitFor(() => expect(screen.getByTestId('ai-edit-actions')).toBeTruthy());
      expect(runChatCompletionImpl).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', outer);
    }
  });

  it('refuses to write over a file that changed since the request', async () => {
    configureAi();
    const { onClose } = renderDialog();
    await askFor();
    editor.version = 4;
    fireEvent.click(screen.getByTestId('ai-edit-accept'));
    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-edit-stale')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses an answer that still holds a redacted secret', async () => {
    configureAi();
    renderDialog({ answer: '```js\nkey("<redacted>")\n```' });
    await askFor();
    expect(screen.getByTestId('ai-edit-masked')).toBeTruthy();
    expect((screen.getByTestId('ai-edit-accept') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId('ai-edit-accept'), { key: 'Enter', metaKey: true });
    expect(editor.executeEdits).not.toHaveBeenCalled();
  });

  it('toggles the diff of the whole file', async () => {
    configureAi();
    renderDialog();
    await askFor();
    fireEvent.click(screen.getByTestId('ai-edit-show-diff'));
    expect(screen.getByTestId('diff-stub').textContent).toBe('const total = a + b;→const total = 1 + 2;');
    fireEvent.click(screen.getByTestId('ai-edit-show-diff'));
    expect(screen.queryByTestId('diff-stub')).toBeNull();
  });

  it('shows a provider failure', async () => {
    configureAi();
    const runChatCompletionImpl = vi.fn().mockResolvedValue({ ok: false, kind: 'auth', message: 'bad key' });
    render(<EditWithAiDialog request={request} onClose={vi.fn()} runChatCompletionImpl={runChatCompletionImpl as never} runPreviewImpl={vi.fn() as never} />);
    fireEvent.change(screen.getByTestId('ai-edit-instruction'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('ai-edit-send'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('closes on Escape without reaching window listeners', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    try {
      renderDialog({ onClose });
      fireEvent.keyDown(screen.getByTestId('ai-edit-instruction'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', outer);
    }
  });
});
