/**
 * T19 / RL-031 Slice 4 — "Explain this error" dialog. Verifies the consent
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

describe('ExplainErrorDialog (T19)', () => {
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
});
