/**
 * internal — "Explain this code" dialog. Verifies the consent gate (nothing
 * sends on mount), the entitlement + configuration degradations, and the
 * send → streamed result path, all in a real React render with real i18n.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { ExplainCodeDialog } from '../../../src/renderer/components/AI/ExplainCodeDialog';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

function configureAi(): void {
  useAiConfigStore.setState({
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'qwen3-coder',
  });
}

const baseProps = {
  code: 'const doubled = xs.map((n) => n * 2);',
  language: 'javascript',
  filename: 'scratch.js',
  onClose: () => {},
};

describe('ExplainCodeDialog', () => {
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
    render(<ExplainCodeDialog {...baseProps} />);
    expect(screen.getByTestId('ai-explain-code-upsell')).toBeTruthy();
    expect(screen.queryByTestId('ai-explain-code-send')).toBeNull();
  });

  it('prompts to configure when entitled but no endpoint/key/model', () => {
    render(<ExplainCodeDialog {...baseProps} />);
    expect(screen.getByTestId('ai-explain-code-unconfigured')).toBeTruthy();
    expect(screen.queryByTestId('ai-explain-code-send')).toBeNull();
  });

  it('previews the exact payload and sends nothing on mount', () => {
    configureAi();
    const runChatCompletionImpl = vi.fn();
    render(
      <ExplainCodeDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    const preview = screen.getByTestId('ai-explain-code-preview');
    expect(preview.textContent).toContain('const doubled = xs.map');
    expect(preview.textContent).toContain('javascript');
    expect(runChatCompletionImpl).not.toHaveBeenCalled();
  });

  it('flags redacted secrets in the preview', () => {
    configureAi();
    render(
      <ExplainCodeDialog
        {...baseProps}
        code={'const API_KEY = "sk-ant-abcdefghijklmnop1234"'}
      />
    );
    expect(screen.getByTestId('ai-explain-code-redacted')).toBeTruthy();
    expect(
      screen.getByTestId('ai-explain-code-preview').textContent
    ).not.toContain('sk-ant-abcdefghijklmnop1234');
  });

  it('sends on click and renders the completion', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'It doubles every number in xs.' });
    render(
      <ExplainCodeDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-code-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-result')).toBeTruthy()
    );
    expect(screen.getByTestId('ai-explain-result').textContent).toContain(
      'It doubles every number in xs.'
    );
    expect(runChatCompletionImpl).toHaveBeenCalledTimes(1);
  });

  it('renders a failure and offers to go back', async () => {
    configureAi();
    const runChatCompletionImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'auth', message: 'bad key' });
    render(
      <ExplainCodeDialog
        {...baseProps}
        runChatCompletionImpl={runChatCompletionImpl as never}
      />
    );
    fireEvent.click(screen.getByTestId('ai-explain-code-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-explain-code-error')).toBeTruthy()
    );
    expect(screen.getByTestId('ai-explain-code-retry')).toBeTruthy();
  });
});
