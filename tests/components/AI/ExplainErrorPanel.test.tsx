import { previewOf } from '../../../src/shared/ai/explainError';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ExplainErrorPanel } from '../../../src/renderer/components/AI/ExplainErrorPanel';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useExplainPanelStore, type ExplainTarget } from '../../../src/renderer/stores/explainPanelStore';
import { useResultStore } from '../../../src/renderer/stores/resultStore';

const run = vi.fn();
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({ useEntitlement: () => true }));
vi.mock('../../../src/renderer/hooks/useRunner', () => ({ useRunner: () => ({ run, isRunning: false }) }));

const CODE = "const user = null;\nconst name = user.name;";
const FIX = "const user = null;\nconst name = user?.name;";
const target: ExplainTarget = { tabId: 't1', errorMessage: "TypeError: Cannot read properties of null (reading 'name')", line: 2, column: 19 };
const answer = (content: string) => vi.fn(async () => ({ ok: true as const, content }));

beforeAll(async () => {
  await initI18n('en');
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  run.mockClear();
  localStorage.clear();
  useAiConfigStore.setState({ endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'k', model: 'm' });
  useEditorStore.getState().restoreTabs([{ id: 't1', name: 'greeting.js', language: 'javascript', content: CODE }] as never, 't1');
  useExplainPanelStore.setState({ target, pinned: false, threads: {} });
  useResultStore.setState({ scopeSnapshot: null });
});

describe('anchored explain panel', () => {
  it('retries an edited SQL request with the exact consent preview it sends', async () => {
    const sqlA = 'SELECT synthetic_a FROM fixture_a;';
    const sqlB = 'SELECT synthetic_b FROM fixture_b;';
    act(() => useEditorStore.getState().restoreTabs([
      { id: 't1', name: 'fixture.sql', language: 'sql', content: sqlA },
    ] as never, 't1'));
    const impl = vi.fn()
      .mockResolvedValueOnce({ ok: false, kind: 'network', message: 'Synthetic failure' })
      .mockResolvedValue({ ok: true, content: 'Synthetic answer.' });
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={impl} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await screen.findByTestId('ai-explain-error');
    act(() => useEditorStore.getState().updateContent('t1', sqlB));
    fireEvent.click(screen.getByTestId('ai-explain-retry'));
    const preview = screen.getByTestId('ai-explain-preview').textContent;
    expect(preview).toContain(sqlB);
    expect(preview).not.toContain(sqlA);
    expect(impl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await screen.findByText('Synthetic answer.');
    const messages = impl.mock.calls[1]![0].messages;
    expect(preview).toBe(previewOf(messages));
    expect(messages.at(-1).content).toContain(sqlB);
    expect(useExplainPanelStore.getState().threadFor('t1', target.errorMessage, useAiConfigStore.getState().endpoint)).toEqual([
      ...messages, { role: 'assistant', content: 'Synthetic answer.' },
    ]);
  });

  it('names the file and line and sends nothing until Send', () => {
    const impl = answer('x');
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={impl} />);
    expect(screen.getByRole('complementary', { name: 'Explain this error' }).textContent).toContain('greeting.js:2');
    expect(screen.getByTestId('ai-explain-preview').textContent).toContain('user.name');
    expect(impl).not.toHaveBeenCalled();
  });

  it('adds the last run values only when asked, with secret names redacted', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 1,
        variables: [
          { name: 'user', value: { kind: 'primitive', type: 'null', repr: 'null' } },
          { name: 'apiToken', value: { kind: 'primitive', type: 'string', repr: '"abc"' } },
        ],
      },
    });
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={answer('x')} />);
    expect(screen.getByTestId('ai-explain-preview').textContent).not.toContain('Runtime values');
    fireEvent.click(screen.getByTestId('ai-explain-include-values'));
    expect(screen.getByTestId('ai-explain-preview').textContent).toContain('Runtime values:\nuser = null\napiToken = <redacted>');
    expect(screen.getByTestId('ai-explain-redacted').textContent).toBe('· 1 secret redacted');
  });

  it('keeps the thread with the tab, so reopening shows the answer without sending again', async () => {
    const impl = answer('Use optional chaining.');
    const { unmount } = render(<ExplainErrorPanel target={target} runChatCompletionImpl={impl} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await screen.findByText('Use optional chaining.');
    unmount();
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={impl} />);
    expect(screen.getByText('Use optional chaining.')).toBeTruthy();
    expect(screen.queryByTestId('ai-explain-send')).toBeNull();
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('shows the payload that was sent once the code changes after Send', async () => {
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={answer('Answer.')} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    await screen.findByText('Answer.');
    act(() => useEditorStore.getState().updateContent('t1', 'const totallyNew = 1;'));
    expect(screen.getByTestId('ai-explain-preview').textContent).toContain('user.name');
    expect(screen.getByTestId('ai-explain-preview').textContent).not.toContain('totallyNew');
  });

  it('applies a fix with or without a re-run', async () => {
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={answer(`Fix:\n\n\`\`\`javascript\n${FIX}\n\`\`\``)} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    fireEvent.click(await screen.findByTestId('ai-explain-apply-only'));
    expect(screen.getByText(/without running it/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-explain-apply-confirm'));
    expect(useEditorStore.getState().tabs[0]!.content).toBe(FIX);
    expect(run).not.toHaveBeenCalled();
    act(() => useEditorStore.getState().updateContent('t1', CODE));
    fireEvent.click(screen.getByTestId('ai-explain-apply'));
    fireEvent.click(screen.getByTestId('ai-explain-apply-confirm'));
    expect(run).toHaveBeenCalledTimes(1);    // The code now matches the suggestion, so there is nothing left to apply.
    expect(screen.queryByTestId('ai-explain-apply')).toBeNull();
  });

  it('keeps only the vote and the error kind on this device', async () => {
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={answer('Answer.')} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    fireEvent.click(await screen.findByTestId('ai-explain-not-helpful'));
    expect(screen.getByTestId('ai-explain-not-helpful').getAttribute('aria-pressed')).toBe('true');
    const stored = JSON.parse(localStorage.getItem('lingua-explain-ratings') ?? '[]') as Record<string, unknown>[];
    expect(stored).toEqual([{ at: expect.any(Number), kind: 'TypeError', vote: 'not-helpful' }]);
  });

  it('asks a suggested follow-up with the conversation so far', async () => {
    const impl = answer('Answer.');
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={impl} />);
    fireEvent.click(screen.getByTestId('ai-explain-send'));
    fireEvent.click((await screen.findAllByTestId('ai-explain-chip'))[0]!);
    await waitFor(() => expect(impl).toHaveBeenCalledTimes(2));
    const second = (impl.mock.calls[1] as unknown as [{ messages: { content: string }[] }])[0].messages;
    expect(second.at(-1)?.content).toBe('Why does this happen?');
  });

  it('pins and closes with Escape', () => {
    render(<ExplainErrorPanel target={target} runChatCompletionImpl={answer('x')} />);
    fireEvent.click(screen.getByTestId('ai-explain-panel-pin'));
    expect(useExplainPanelStore.getState().pinned).toBe(true);
    fireEvent.keyDown(screen.getByTestId('ai-explain-panel'), { key: 'Escape' });
    expect(useExplainPanelStore.getState().target).toBeNull();
  });
});
