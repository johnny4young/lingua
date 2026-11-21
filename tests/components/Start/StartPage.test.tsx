import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { EditorEmptyState } from '@/components/Editor/EditorEmptyState';
import { consumeSqlSampleRequest } from '@/components/SqlWorkspace/pendingSqlSample';
import { useEditorStore } from '@/stores/editorStore';
import { resetNativeToolchainStoreForTests, useNativeToolchainStore } from '@/stores/nativeToolchainStore';
import { clearPendingSessionRestoreSnapshot, useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { SEEDED_SCRATCHPAD_NAME, SEEDED_SCRATCHPAD_SOURCE } from '@/onboarding/seedScratchpad';
import { BUILT_IN_TEMPLATES } from '@/data/templates';

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

  it('reopens the whole session from Reopen all', async () => {
    seedSession();
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    await user.click(screen.getByTestId('start-reopen-all'));

    await waitFor(() =>
      expect(useEditorStore.getState().tabs.map(tab => tab.name)).toEqual(['latencies.py', 'never-ran.js', 'broken.ts'])
    );
  });

  it('keeps the last session hidden when restore is set to never', () => {
    seedSession();
    useSettingsStore.setState({ restoreSessionMode: 'never' });
    render(<EditorEmptyState />);
    expect(screen.queryByTestId('start-pick-up')).toBeNull();
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

  it('offers the starters as or-try chips', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);

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
    expect(screen.getByTestId('start-reopen-all').textContent).toBe('Reabrir las 2');
    expect(screen.getByText('Plantillas')).toBeTruthy();
    expect(screen.getByTestId('start-try-sample-table').textContent).toBe('una tabla de ejemplo');
  });
});
