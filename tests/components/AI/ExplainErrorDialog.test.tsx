/**
 * implementation — "Explain this error" dialog. Verifies the consent
 * gate (nothing sends on mount), the entitlement + configuration degradations,
 * and the send → result path — all in a real React render with real i18n.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { ExplainErrorDialog } from '../../../src/renderer/components/AI/ExplainErrorDialog';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

function configureAi(): void {
  useAiConfigStore.setState({
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
  });
}

const baseProps = {
  errorMessage: "NameError: name 'x' is not defined",
  code: 'print(x)',
  language: 'python',
  onClose: () => {},
};

describe('ExplainErrorDialog ', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    entitled = true;
    useAiConfigStore.getState().clear();
  });

  it('shows an upsell when the user lacks the LOCAL_AI entitlement', () => {
    entitled = false;
    configureAi();
    render(<ExplainErrorDialog {...baseProps} />);
    expect(screen.getByTestId('ai-explain-upsell')).toBeTruthy();
    expect(screen.queryByTestId('ai-explain-send')).toBeNull();
  });

  it('prompts to configure when entitled but no endpoint/key/model', () => {
    render(<ExplainErrorDialog {...baseProps} />);
    expect(screen.getByTestId('ai-explain-unconfigured')).toBeTruthy();
    expect(screen.queryByTestId('ai-explain-send')).toBeNull();
  });

  it('shows the exact payload preview and sends nothing until Send is clicked', () => {
    configureAi();
    const runChatCompletionImpl = vi.fn();
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    const preview = screen.getByTestId('ai-explain-preview');
    expect(preview.textContent).toContain('NameError');
    expect(preview.textContent).toContain('print(x)');
    // The consent gate: no network call happened on mount.
    expect(runChatCompletionImpl).not.toHaveBeenCalled();
  });

  it('flags redacted secrets in the preview', () => {
    configureAi();
    render(
      <ExplainErrorDialog
        {...baseProps}
        code={'API_KEY = "sk-ant-abcdefghijklmnop1234"'}
      />
    );
    expect(screen.getByTestId('ai-explain-redacted')).toBeTruthy();
    expect(screen.getByTestId('ai-explain-preview').textContent).not.toContain(
      'sk-ant-abcdefghijklmnop1234'
    );
  });

  it('sends on click and renders the completion', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'Define x before using it.' });
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-result')).toBeTruthy()
    );
    expect(screen.getByTestId('ai-explain-result').textContent).toContain(
      'Define x before using it.'
    );
    expect(runChatCompletionImpl).toHaveBeenCalledTimes(1);
  });

  it('renders a failure and offers to go back', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'auth', message: 'bad key' });
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-error')).toBeTruthy()
    );
    expect(screen.getByTestId('ai-explain-retry')).toBeTruthy();
  });

  it('renders streamed partial text progressively before the result settles', async () => {
    configureAi();
    let releaseResult!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const runChatCompletionImpl = vi.fn(
      async (
        _req: unknown,
        _cfg: unknown,
        options?: { onChunk?: (text: string) => void }
      ) => {
        options?.onChunk?.('Partial ans');
        await gate;
        return { ok: true as const, content: 'Partial answer, complete.' };
      }
    );
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    // The chunk renders while the request is still in flight.
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-result').textContent).toContain(
        'Partial ans'
      )
    );
    releaseResult();
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-result').textContent).toContain(
        'Partial answer, complete.'
      )
    );
  });

  it('aborts an in-flight request when the dialog closes', async () => {
    configureAi();
    const onClose = vi.fn();
    let signal: AbortSignal | undefined;
    const runChatCompletionImpl = vi.fn(
      async (
        _req: unknown,
        _cfg: unknown,
        options?: { signal?: AbortSignal }
      ) => {
        signal = options?.signal;
        return new Promise<never>(() => {});
      }
    );
    render(
      <ExplainErrorDialog
        {...baseProps}
        onClose={onClose}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() => expect(runChatCompletionImpl).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('ai-explain-close'));

    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('sends a follow-up turn carrying the whole conversation', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: 'First answer.' })
      .mockResolvedValueOnce({ ok: true, content: 'Second answer.' });
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-followup-input')).toBeTruthy()
    );

    fireEvent.change(screen.getByTestId('ai-explain-followup-input'), {
      target: { value: 'What about optional chaining?' },
    });
    fireEvent.click(screen.getByTestId('ai-explain-followup-send'));

    await waitFor(() =>
      expect(screen.getAllByTestId('ai-explain-result')).toHaveLength(2)
    );
    // The follow-up question stays visible in the transcript.
    expect(
      screen.getByTestId('ai-explain-followup-question').textContent
    ).toContain('optional chaining');

    // The second call re-sends the FULL conversation: initial system+user,
    // the first assistant answer, and the new user question.
    const secondCall = runChatCompletionImpl.mock.calls[1]![0] as {
      messages: readonly { role: string; content: string }[];
    };
    expect(secondCall.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(secondCall.messages[2]!.content).toBe('First answer.');
    expect(secondCall.messages[3]!.content).toBe(
      'What about optional chaining?'
    );
  });

  it('offers Apply & re-run behind a diff preview and applies on confirm', async () => {
    configureAi();
    const onApplyFix = vi.fn();
    const onClose = vi.fn();
    const runChatCompletionImpl = vi.fn().mockResolvedValue({
      ok: true,
      content: 'Fix it like this:\n```python\nprint("fixed")\n```',
    });
    render(
      <ExplainErrorDialog
        {...baseProps}
        onClose={onClose}
        onApplyFix={onApplyFix}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-apply')).toBeTruthy()
    );

    // Step 1: the apply button opens the DIFF preview — nothing applied yet.
    fireEvent.click(screen.getByTestId('ai-explain-apply'));
    expect(screen.getByTestId('ai-explain-apply-diff')).toBeTruthy();
    // Old line removed, suggested line added.
    expect(
      screen.getAllByTestId('ai-explain-apply-diff-remove').length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId('ai-explain-apply-diff-add').length
    ).toBeGreaterThan(0);
    expect(onApplyFix).not.toHaveBeenCalled();

    // Back returns to the answer without applying.
    fireEvent.click(screen.getByTestId('ai-explain-apply-back'));
    expect(screen.getByTestId('ai-explain-result')).toBeTruthy();
    expect(onApplyFix).not.toHaveBeenCalled();

    // Step 2: confirm applies the suggested code and closes the dialog.
    fireEvent.click(screen.getByTestId('ai-explain-apply'));
    fireEvent.click(screen.getByTestId('ai-explain-apply-confirm'));
    expect(onApplyFix).toHaveBeenCalledWith('print("fixed")');
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the apply button when the answer has no code block or no seam', async () => {
    configureAi();
    // Answer WITH code but no onApplyFix seam → no button.
    const runChatCompletionImpl = vi.fn().mockResolvedValue({
      ok: true,
      content: 'Use x.\n```js\nconst x = 1;\n```',
    });
    const { unmount } = render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-followup-input')).toBeTruthy()
    );
    expect(screen.queryByTestId('ai-explain-apply')).toBeNull();
    unmount();

    // Seam wired but answer has NO code block → no button either.
    const noCode = vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'Just prose, no code.' });
    render(
      <ExplainErrorDialog
        {...baseProps}
        onApplyFix={vi.fn()}
        runChatCompletionImpl={noCode as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-followup-input')).toBeTruthy()
    );
    expect(screen.queryByTestId('ai-explain-apply')).toBeNull();
  });

  it('retries a failed follow-up without bouncing back to the consent preview', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: 'First answer.' })
      .mockResolvedValueOnce({ ok: false, kind: 'network', message: 'offline' })
      .mockResolvedValueOnce({ ok: true, content: 'Recovered answer.' });
    render(
      <ExplainErrorDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-followup-input')).toBeTruthy()
    );
    fireEvent.change(screen.getByTestId('ai-explain-followup-input'), {
      target: { value: 'and now?' },
    });
    fireEvent.click(screen.getByTestId('ai-explain-followup-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-error')).toBeTruthy()
    );

    // Retry resends the conversation directly — no preview round-trip.
    fireEvent.click(screen.getByTestId('ai-explain-retry'));
    await waitFor(() =>
      expect(screen.getAllByTestId('ai-explain-result')).toHaveLength(2)
    );
    expect(screen.queryByTestId('ai-explain-preview')).toBeNull();
    expect(runChatCompletionImpl).toHaveBeenCalledTimes(3);
  });
});
