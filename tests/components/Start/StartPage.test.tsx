import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { EditorEmptyState } from '@/components/Editor/EditorEmptyState';
import { consumeSqlSampleRequest } from '@/components/SqlWorkspace/pendingSqlSample';
import { useEditorStore } from '@/stores/editorStore';
import { resetNativeToolchainStoreForTests, useNativeToolchainStore } from '@/stores/nativeToolchainStore';
import { armPendingSessionRestoreSnapshot, clearPendingSessionRestoreSnapshot, useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { SEEDED_SCRATCHPAD_NAME, SEEDED_SCRATCHPAD_SOURCE } from '@/onboarding/seedScratchpad';
import { BUILT_IN_TEMPLATES } from '@/data/templates';
import type { StartPromptEditorProps } from '@/components/Start/StartPromptEditor';

// Monaco does not run in jsdom; the stand-in keeps the props contract and the editor's class.
vi.mock('@/components/Start/StartPromptEditor', () => ({
  StartPromptEditor: ({ value, ariaLabel, placeholder, onChange, onSubmit }: StartPromptEditorProps) => (
    <div className="monaco-editor" tabIndex={0} data-testid="start-prompt-surface">
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') onSubmit();
        }}
      />
    </div>
  ),
}));

interface LinguaWindow extends Window {
  lingua?: { platform: string };
}

const HOUR = 3_600_000;

function setPlatform(platform: 'web' | 'darwin' | null): void {
  const target = globalThis as unknown as LinguaWindow;
  if (platform) target.lingua = { platform };
  else delete target.lingua;
}

function seedSession(): void {
  const now = Date.now();
  useSessionStore.setState({
    savedTabs: [
      {
        name: 'latencies.py',
        language: 'python',
        content: 'print(1.24)',
        lastAnswer: { kind: 'code', status: 'ok', numeral: '1.24', label: 's', durationMs: 412, deltaMs: -86, ranAt: now - 2 * HOUR },
      },
      { name: 'never-ran.js', language: 'javascript', content: '' },
      {
        name: 'broken.ts',
        language: 'typescript',
        content: 'throw new TypeError()',
        lastAnswer: { kind: 'code', status: 'error', numeral: '', label: 'TypeError', ranAt: now - 5 * 60_000 },
      },
    ],
    savedActiveIndex: 0,
  });
  armPendingSessionRestoreSnapshot();
}

describe('Start page', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    setPlatform(null);
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSessionStore.setState({ savedTabs: [], savedActiveIndex: -1 });
    clearPendingSessionRestoreSnapshot();
    useSettingsStore.setState({ restoreSessionMode: 'ask' });
    useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
    resetNativeToolchainStoreForTests();
    consumeSqlSampleRequest();
  });

  afterEach(() => setPlatform(null));

  it('leaves out Pick up when the last session left no answers', () => {
    render(<EditorEmptyState />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Say something in code.');
    expect(screen.queryByTestId('start-pick-up')).toBeNull();
    expect(screen.getByTestId('start-new')).toBeTruthy();
    expect(screen.getByTestId('start-templates')).toBeTruthy();
  });

  it('lists each answered tab with its numeral, unit, timing and age', () => {
    seedSession();
    render(<EditorEmptyState />);

    const section = screen.getByTestId('start-pick-up');
    expect(within(section).getByText('2 from your last session')).toBeTruthy();
    const first = screen.getByTestId('start-pick-up-row-1');
    expect(first.getAttribute('aria-label')).toBe('Reopen latencies.py');
    expect(first.textContent).toContain('scratch · Python');
    expect(first.textContent).toContain('1.24');
    expect(first.textContent).toContain('412 ms');
    expect(within(first).getByRole('img', { name: '86 ms faster than the run before' })).toBeTruthy();
    const second = screen.getByTestId('start-pick-up-row-2');
    expect(second.textContent).toContain('TypeError');
    expect(screen.queryByTestId('start-pick-up-row-3')).toBeNull();
  });

  it('reopens one tab from its row or digit and keeps the others offered', async () => {
    seedSession();
    useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: 'editor.restoreSession.prompt', values: { count: 3 }, sticky: true });
    const { unmount } = render(<EditorEmptyState />);

    fireEvent.keyDown(window, { key: '2' });

    await waitFor(() => expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['broken.ts']));
    expect(useUIStore.getState().statusNotice).toBeNull();
    unmount();

    useEditorStore.setState({ tabs: [], activeTabId: null });
    render(<EditorEmptyState />);
    expect(screen.getByTestId('start-pick-up-row-1').getAttribute('aria-label')).toBe('Reopen latencies.py');
    expect(screen.queryByTestId('start-pick-up-row-2')).toBeNull();
  });

  it('opens one copy when a row is triggered twice before its restore lands', async () => {
    seedSession();
    render(<EditorEmptyState />);

    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '1' });

    await waitFor(() => expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['latencies.py']));
  });

  it('reopens the whole session from Reopen all', async () => {
    seedSession();
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    await user.click(screen.getByTestId('start-reopen-all'));

    await waitFor(() =>
      expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['latencies.py', 'never-ran.js', 'broken.ts'])
    );
  });

  it('lists only a pinned last session, never the autosave of this one', () => {
    seedSession();
    clearPendingSessionRestoreSnapshot();
    render(<EditorEmptyState />);
    expect(screen.queryByTestId('start-pick-up')).toBeNull();

    act(() => void armPendingSessionRestoreSnapshot());
    expect(screen.getByTestId('start-pick-up')).toBeTruthy();
  });

  it('reads a test answer with the verb agreeing with its numeral in Spanish', async () => {
    await i18next.changeLanguage('es');
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'cart.test.ts',
          language: 'typescript',
          content: '',
          lastAnswer: { kind: 'tests', status: 'error', numeral: '1', unit: 'failed', total: 6, ranAt: Date.now() - HOUR },
        },
      ],
      savedActiveIndex: 0,
    });
    armPendingSessionRestoreSnapshot();
    render(<EditorEmptyState />);
    expect(screen.getByTestId('start-pick-up-row-1').textContent).toContain('de 6 falló');
  });

  it('names SQL and HTTP rows by what answered, with where they ran', () => {
    const ranAt = Date.now() - HOUR;
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'SQL',
          language: 'sql',
          content: '',
          kind: 'sql',
          lastAnswer: { kind: 'sql', status: 'ok', numeral: '12', unit: 'rows', subject: 'orders by city', context: 'orders-dev · Postgres', ranAt },
        },
        {
          name: 'HTTP',
          language: 'http',
          content: '',
          kind: 'http',
          lastAnswer: { kind: 'http', status: 'ok', numeral: '200', unit: 'status', label: 'OK', subject: 'GET /v1/services', context: 'staging', ranAt },
        },
        // Saved before answers carried a context: the row reads the same, without one.
        {
          name: 'SQL',
          language: 'sql',
          content: '',
          kind: 'sql',
          lastAnswer: { kind: 'sql', status: 'ok', numeral: '3', unit: 'rows', subject: 'cities', ranAt },
        },
      ],
      savedActiveIndex: 0,
    });
    armPendingSessionRestoreSnapshot();
    render(<EditorEmptyState />);

    const detail = (row: number) => screen.getByTestId(`start-pick-up-row-${row}`).querySelector('.start-row-detail')?.textContent;
    expect(screen.getByTestId('start-pick-up-row-1').getAttribute('aria-label')).toBe('Reopen orders by city');
    expect(detail(1)).toBe('orders-dev · Postgres');
    expect(detail(2)).toBe('staging');
    expect(screen.getByTestId('start-pick-up-row-3').getAttribute('aria-label')).toBe('Reopen cities');
    expect(detail(3)).toBeUndefined();
  });

  it('holds a short name at its full width and lets a long one truncate no shorter than 12 characters', () => {
    useSessionStore.setState({
      savedTabs: [
        { name: 'a.js', language: 'javascript', content: '', lastAnswer: { kind: 'code', status: 'ok', numeral: '1', ranAt: Date.now() } },
        { name: 'break-even-forecast.ts', language: 'typescript', content: '', lastAnswer: { kind: 'code', status: 'ok', numeral: '2', ranAt: Date.now() } },
        { name: '数据.py', language: 'python', content: '', lastAnswer: { kind: 'code', status: 'ok', numeral: '3', ranAt: Date.now() } },
      ],
      savedActiveIndex: 0,
    });
    armPendingSessionRestoreSnapshot();
    render(<EditorEmptyState />);

    const nameMin = (row: number) =>
      (screen.getByTestId(`start-pick-up-row-${row}`).querySelector('.start-row-name') as HTMLElement).style.getPropertyValue('--start-name-min');
    expect(nameMin(1)).toBe('4ch');
    expect(nameMin(2)).toBe('12ch');
    expect(nameMin(3)).toBe('7ch');
  });

  it('says how each language runs on the web build and opens a scratch tab in it', async () => {
    setPlatform('web');
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    expect(screen.getByTestId('start-new-javascript-availability').textContent).toBe('in the browser');
    expect(screen.getByTestId('start-new-go-availability').textContent).toBe('Desktop only');
    expect(screen.getByTestId('start-new-rust-availability').textContent).toBe('Desktop only');

    await user.click(screen.getByTestId('start-new-python'));
    expect(useEditorStore.getState().tabs[0]?.language).toBe('python');
  });

  it('reads Go and Rust from the toolchain detection on desktop', () => {
    setPlatform('darwin');
    useNativeToolchainStore.getState().report('go', { installed: true });
    useNativeToolchainStore.getState().report('rust', { installed: false, reason: 'missing' });
    render(<EditorEmptyState />);

    expect(screen.getByTestId('start-new-javascript-availability').textContent).toBe('offline');
    expect(screen.getByTestId('start-new-go-availability').textContent).toBe('Go found');
    expect(screen.getByTestId('start-new-rust-availability').textContent).toBe('not installed');
  });

  it('opens workspaces from their tiles', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    await user.click(screen.getByTestId('start-workspace-sql'));
    expect(useEditorStore.getState().tabs.map(tab => tab.kind)).toEqual(['sql']);
  });

  it('filters templates by language and opens one with its stable file name', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);
    const list = screen.getByTestId('start-templates-list');
    expect(within(list).getAllByRole('button')).toHaveLength(BUILT_IN_TEMPLATES.length);

    await user.click(screen.getByTestId('start-templates-filter-python'));

    const pythonCount = BUILT_IN_TEMPLATES.filter(template => template.language === 'python').length;
    expect(within(list).getAllByRole('button')).toHaveLength(pythonCount);
    expect(screen.getByTestId('start-templates-filter-python').getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByTestId('start-template-py-hello'));
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ name: 'Hello World.py', language: 'python' });
  });

  it('keeps the prompt line as a scratch tab on Enter', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);
    const prompt = screen.getByTestId('start-prompt');
    const field = within(prompt).getByRole('textbox', { name: 'Run a line of code' });
    expect(field.getAttribute('placeholder')).toBe('[1, 2, 3].map(n => n * n)');
    expect(screen.queryByTestId('start-prompt-hint')).toBeNull();
    expect(screen.queryByTestId('start-prompt-enter')).toBeNull();

    await user.type(field, '6 * 7');
    expect(screen.getByTestId('start-prompt-enter').textContent).toBe('↵keep it as a scratch file');
    await user.keyboard('{Enter}');

    expect(useEditorStore.getState().tabs[0]).toMatchObject({ language: 'javascript', content: '6 * 7' });
  });

  it('leaves digits typed into the prompt to the prompt', async () => {
    seedSession();
    render(<EditorEmptyState />);
    const surface = screen.getByTestId('start-prompt-surface');
    surface.focus();
    fireEvent.keyDown(surface, { key: '1' });
    // A reopen restores asynchronously; give it the time the row test waits for.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('offers the starters as or-try chips inside the prompt', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);
    expect(within(screen.getByTestId('start-prompt')).getByTestId('start-try-welcome')).toBeTruthy();

    await user.click(screen.getByTestId('start-try-welcome'));
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ name: SEEDED_SCRATCHPAD_NAME, content: SEEDED_SCRATCHPAD_SOURCE });

    useEditorStore.setState({ tabs: [], activeTabId: null });
    await user.click(screen.getByTestId('start-try-sample-table'));
    expect(useEditorStore.getState().tabs.map(tab => tab.kind)).toEqual(['sql']);
    expect(consumeSqlSampleRequest()).toBe(true);
  });

  it('renders the Start copy in Spanish', async () => {
    seedSession();
    await i18next.changeLanguage('es');
    render(<EditorEmptyState />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Di algo en código.');
    expect(screen.getByText('Retoma donde respondió')).toBeTruthy();
    expect(screen.getByTestId('start-reopen-all').textContent).toBe('Reabrir las 3');
    expect(screen.getByText('Plantillas')).toBeTruthy();
    expect(screen.getByTestId('start-try-sample-table').textContent).toBe('una tabla de ejemplo');
    expect(screen.getByRole('textbox', { name: 'Ejecuta una línea de código' })).toBeTruthy();
  });
});
