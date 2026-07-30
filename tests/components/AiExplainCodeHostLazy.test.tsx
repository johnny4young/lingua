import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiExplainCodeHost } from '@/components/AI/AiExplainCodeHost';
import { useAiExplainCodeStore } from '@/stores/aiExplainCodeStore';

const mocks = vi.hoisted(() => ({
  loadDialog: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/components/AI/aiExplainCodeDialogLoader', () => ({
  loadAiExplainCodeDialog: mocks.loadDialog,
}));

vi.mock('@/hooks/useStatusNotice', () => ({
  useStatusNotice: () => ({
    error: mocks.pushErrorNotice,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function DialogProbe({
  code,
  language,
  onClose,
}: {
  code: string;
  language: string;
  onClose: () => void;
}) {
  return (
    <div data-testid="ai-explain-code-dialog">
      <span data-testid="dialog-request">
        {language}:{code}
      </span>
      <button type="button" onClick={onClose}>
        Close dialog
      </button>
    </div>
  );
}

describe('AiExplainCodeHost lazy dialog', () => {
  beforeEach(() => {
    useAiExplainCodeStore.setState({ request: null });
    mocks.loadDialog.mockReset();
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads after the first request, deduplicates pending work, and reuses the dialog', async () => {
    const pending = deferred<{ ExplainCodeDialog: typeof DialogProbe }>();
    mocks.loadDialog.mockReturnValue(pending.promise);
    render(
      <StrictMode>
        <AiExplainCodeHost />
      </StrictMode>
    );

    expect(mocks.loadDialog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-explain-code-loading-dialog')).toBeNull();

    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'first()', language: 'javascript' });
    });
    expect(screen.getByTestId('ai-explain-code-loading-dialog')).toBeTruthy();
    expect(mocks.loadDialog).toHaveBeenCalledTimes(1);

    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'second()', language: 'typescript' });
    });
    expect(mocks.loadDialog).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ExplainCodeDialog: DialogProbe });
    });
    expect(await screen.findByTestId('ai-explain-code-dialog')).toBeTruthy();
    expect(screen.getByTestId('dialog-request').textContent).toBe('typescript:second()');

    act(() => {
      useAiExplainCodeStore.getState().close();
      useAiExplainCodeStore.getState().open({ code: 'third()', language: 'python' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('dialog-request').textContent).toBe('python:third()');
    });
    expect(mocks.loadDialog).toHaveBeenCalledTimes(1);
  });

  it('lets the user close the loading shell without discarding the pending module', async () => {
    const pending = deferred<{ ExplainCodeDialog: typeof DialogProbe }>();
    mocks.loadDialog.mockReturnValue(pending.promise);
    render(<AiExplainCodeHost />);

    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'cancel()', language: 'javascript' });
    });
    expect(screen.getByTestId('ai-explain-code-loading-dialog')).toBeTruthy();

    act(() => {
      screen.getByRole('button', { name: 'Close' }).click();
    });
    expect(useAiExplainCodeStore.getState().request).toBeNull();
    expect(screen.queryByTestId('ai-explain-code-loading-dialog')).toBeNull();

    await act(async () => {
      pending.resolve({ ExplainCodeDialog: DialogProbe });
    });
    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'next()', language: 'javascript' });
    });
    expect(await screen.findByTestId('ai-explain-code-dialog')).toBeTruthy();
    expect(mocks.loadDialog).toHaveBeenCalledTimes(1);
  });

  it('closes a failed request, surfaces a localized notice, and allows retry', async () => {
    const error = new Error('dialog chunk unavailable');
    mocks.loadDialog.mockRejectedValueOnce(error).mockResolvedValueOnce({
      ExplainCodeDialog: DialogProbe,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AiExplainCodeHost />);

    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'broken()', language: 'javascript' });
    });

    await waitFor(() => {
      expect(mocks.pushErrorNotice).toHaveBeenCalledWith('ai.explainCode.loadFailed');
    });
    expect(consoleError).toHaveBeenCalledWith('[ai] failed to load the explain-code dialog', error);
    expect(useAiExplainCodeStore.getState().request).toBeNull();

    act(() => {
      useAiExplainCodeStore.getState().open({ code: 'retry()', language: 'javascript' });
    });
    expect(await screen.findByTestId('ai-explain-code-dialog')).toBeTruthy();
    expect(mocks.loadDialog).toHaveBeenCalledTimes(2);
  });
});
