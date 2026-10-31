import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/hooks/useRunner', () => ({ useRunner: () => ({ run, isRunning: false }) }));

import { initI18n } from '@/i18n';
import { RunRegions } from '@/components/RunRegions/RunRegions';
import { RunRegionsHost } from '@/components/RunRegions/RunRegionsHost';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useRunRegionStore } from '@/stores/runRegionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { parseRunRegions } from '@/utils/runRegions';

const CODE = ['const a = [1, 2];', '// %% sort', 'a.sort();', '// %% size · fast', 'a.length', '', '// %%', 'console.log(a);'].join('\n');

function fakeEditor(code: string) {
  const lines = code.split('\n');
  let cursor: ((event: { position: { lineNumber: number } }) => void) | null = null;
  const actions: Array<{ id: string; keybindings: number[]; run: () => void }> = [];
  const decorations: unknown[][] = [];
  const zones: Array<{ afterLineNumber: number }> = [];
  const editor = {
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    onDidChangeCursorPosition: (listener: typeof cursor) => {
      cursor = listener;
      return { dispose: vi.fn() };
    },
    addAction: vi.fn((action: (typeof actions)[number]) => {
      actions.push(action);
      return { dispose: vi.fn() };
    }),
    createDecorationsCollection: vi.fn((items: unknown[]) => {
      decorations.push(items);
      return { clear: vi.fn(), getRange: () => null };
    }),
    changeViewZones: (change: (accessor: { addZone: (zone: { afterLineNumber: number }) => string; removeZone: () => void }) => void) =>
      change({ addZone: zone => (zones.push(zone), 'zone'), removeZone: vi.fn() }),
    getLayoutInfo: () => ({ contentWidth: 900 }),
    onDidLayoutChange: () => ({ dispose: vi.fn() }),
    onDidChangeModelContent: () => ({ dispose: vi.fn() }),
    addContentWidget: vi.fn((widget: { getDomNode: () => HTMLElement }) => document.body.appendChild(widget.getDomNode())),
    removeContentWidget: vi.fn((widget: { getDomNode: () => HTMLElement }) => widget.getDomNode().remove()),
    layoutContentWidget: vi.fn(),
    getModel: () => ({
      getLineCount: () => lines.length,
      getLineContent: (line: number) => lines[line - 1] ?? '',
      getLineMaxColumn: (line: number) => (lines[line - 1] ?? '').length + 1,
    }),
    executeEdits: vi.fn(),
    setPosition: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    focus: vi.fn(),
  };
  return { editor, actions, decorations, zones, moveTo: (line: number) => act(() => cursor?.({ position: { lineNumber: line } })) };
}

const monaco = {
  Range: class {
    constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
  },
  KeyMod: { CtrlCmd: 2048, Shift: 1024 },
  KeyCode: { Enter: 3 },
  editor: { ContentWidgetPositionPreference: { BELOW: 2, EXACT: 0 } },
};

const initialSettings = useSettingsStore.getState();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  run.mockClear();
  useRunRegionStore.setState({ last: null });
  useResultStore.setState({ lineResults: [] });
});

afterEach(() => {
  useSettingsStore.setState(initialSettings, true);
});

describe('run regions', () => {
  it('names the regions, follows the cursor and runs the region at the cursor or the whole file', () => {
    const fake = fakeEditor(CODE);
    render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);

    const chips = screen.getAllByTestId('run-regions-chip');
    expect(chips.map(chip => chip.textContent)).toEqual(['Top', 'sort', 'size', 'Region 4']);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
    fake.moveTo(5);
    expect(screen.getAllByTestId('run-regions-chip')[2]!.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.stringify(fake.decorations.at(-1))).toContain('"startLineNumber":4');
    expect(JSON.stringify(fake.decorations.at(-1))).toContain('lingua-region-active');

    // Cmd+Enter belongs to the Run shortcut (regionRunAtCursor); the editor only adds Run all.
    expect(fake.actions.map(action => action.id)).toEqual(['lingua.runRegions.runAll']);
    expect(fake.actions[0]!.keybindings).toEqual([2048 | 1024 | 3]);
    fake.actions[0]!.run();
    expect(run).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByTestId('run-regions-run'));
    expect(run).toHaveBeenLastCalledWith({ region: expect.objectContaining({ name: 'size', startLine: 4, endLine: 6 }), maskedStdin: [] });

    fireEvent.click(chips[1]!);
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith({ lineNumber: 3, column: 1 });

    act(() => useSettingsStore.setState({ shortcutOverrides: { 'run-toggle': [{ tokens: ['Mod', 'R'] }] } }));
    expect(screen.getByTestId('run-regions-run').getAttribute('title')).toMatch(/R$/);
  });

  it('shows the latest region output under its last code line and writes its value back as a comment', () => {
    const fake = fakeEditor(CODE);
    const region = parseRunRegions(CODE, 'javascript')[2]!;
    const rows = [
      { line: 5, value: '2', type: 'autoLog' as const },
      { line: 6, value: 'noise', type: 'log' as const },
    ];
    useResultStore.setState({ lineResults: [{ line: 3, value: 'from a later run', type: 'autoLog' }] });
    useRunRegionStore.setState({ last: { tabId: 't1', region, ranAt: Date.UTC(2026, 9, 31, 14, 41), executionTime: 0.3, ok: true, message: '', rows } });
    render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);

    const card = screen.getByTestId('run-regions-card');
    expect(card.getAttribute('aria-label')).toBe('Output of region size');
    expect(fake.zones.at(-1)).toMatchObject({ afterLineNumber: 5 });
    expect(fake.editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(6);
    expect(screen.getByTestId('run-regions-rows').textContent).toContain('L5');
    expect(screen.getByTestId('run-regions-rows').textContent).not.toContain('from a later run');
    expect(screen.getByTestId('run-regions-ran').textContent).toContain('0.3 ms');

    fireEvent.click(screen.getByTestId('run-regions-insert'));
    expect(fake.editor.executeEdits).toHaveBeenCalledWith('lingua.runRegions', [
      { range: expect.objectContaining({ startLineNumber: 5, startColumn: 9 }), text: ' // => 2' },
    ]);
    fireEvent.click(screen.getByTestId('run-regions-rerun'));
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [] });
    fireEvent.click(screen.getByTestId('run-regions-close'));
    expect(useRunRegionStore.getState().last).toBeNull();
  });

  it('keeps a named region card when a marker is added above it', () => {
    const region = parseRunRegions(CODE, 'javascript')[2]!;
    useRunRegionStore.setState({ last: { tabId: 't1', region, ranAt: 0, executionTime: 1, ok: true, message: '', rows: [] } });
    const moved = CODE.replace('// %% size', '// %% extra\nlet b = 1;\n// %% size');
    render(<RunRegions editor={fakeEditor(moved).editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={moved} />);
    expect(screen.getByTestId('run-regions-card').getAttribute('aria-label')).toBe('Output of region size');
  });

  it('asks for a missing stdin line, keeps plain answers in the tab and masked ones in memory', async () => {
    const fake = fakeEditor(CODE);
    const region = parseRunRegions(CODE, 'javascript')[2]!;
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: CODE, stdinBuffer: 'first' }] as never, 't1');
    useRunRegionStore.setState({ masked: {}, last: { tabId: 't1', region, ranAt: 1, executionTime: 1, ok: true, message: '', rows: [], request: { message: 'Your name?', line: 5 } } });
    render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);

    expect(screen.getByTestId('run-regions-stdin').textContent).toContain('prompt · Your name? · L5');
    expect(screen.queryByText('No output')).toBeNull();
    const input = screen.getByTestId('run-regions-stdin-input') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.getAttribute('aria-label')).toBe('stdin for region size');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'Ada' } });
    fireEvent.submit(input.form!);
    expect(useEditorStore.getState().tabs[0]!.stdinBuffer).toBe('first\nAda');
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [] });

    act(() => useRunRegionStore.setState({ last: { ...useRunRegionStore.getState().last!, ranAt: 2, request: { message: 'Password:' } } }));
    const secret = screen.getByTestId('run-regions-stdin-input') as HTMLInputElement;
    expect(secret.type).toBe('password');
    fireEvent.change(secret, { target: { value: 'hunter2' } });
    fireEvent.submit(secret.form!);
    expect(useEditorStore.getState().tabs[0]!.stdinBuffer).toBe('first\nAda');
    expect(useRunRegionStore.getState().masked.t1).toEqual({ input: 'first\nAda', content: CODE, answers: [{ index: 2, value: 'hunter2' }] });
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [{ index: 2, value: 'hunter2' }] });

    act(() => useRunRegionStore.setState({ last: { ...useRunRegionStore.getState().last!, ranAt: 3, request: { message: 'API token' } } }));
    const token = screen.getByTestId('run-regions-stdin-input') as HTMLInputElement;
    fireEvent.change(token, { target: { value: 't0k' } });
    fireEvent.submit(token.form!);
    expect(useRunRegionStore.getState().masked.t1!.answers).toEqual([{ index: 2, value: 'hunter2' }, { index: 3, value: 't0k' }]);

    // A plain answer after the masked ones keeps them in place; an edit in Input drops them.
    act(() => useRunRegionStore.setState({ last: { ...useRunRegionStore.getState().last!, ranAt: 4, request: { message: 'City?' } } }));
    const city = screen.getByTestId('run-regions-stdin-input') as HTMLInputElement;
    fireEvent.change(city, { target: { value: 'Paris' } });
    fireEvent.submit(city.form!);
    expect(useEditorStore.getState().tabs[0]!.stdinBuffer).toBe('first\nAda\nParis');
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [{ index: 2, value: 'hunter2' }, { index: 3, value: 't0k' }] });
    act(() => useEditorStore.getState().updateContent('t1', `${CODE}\n// edited`));
    fireEvent.click(screen.getByTestId('run-regions-rerun'));
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [] });
    act(() => useEditorStore.getState().updateContent('t1', CODE));
    act(() => useEditorStore.getState().setTabStdinBuffer('t1', 'first'));
    fireEvent.click(screen.getByTestId('run-regions-rerun'));
    expect(run).toHaveBeenLastCalledWith({ region, maskedStdin: [] });

    act(() => useEditorStore.getState().restoreTabs([], null));
    expect(useRunRegionStore.getState().masked.t1).toBeUndefined();
  });

  it('answers with Cmd or Ctrl+Enter in the row without reaching the Run shortcut', () => {
    const fake = fakeEditor(CODE);
    const region = parseRunRegions(CODE, 'javascript')[2]!;
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: CODE }] as never, 't1');
    useRunRegionStore.setState({ masked: {}, last: { tabId: 't1', region, ranAt: 5, executionTime: 1, ok: true, message: '', rows: [], request: { message: 'Name?' } } });
    const windowKeys = vi.fn();
    window.addEventListener('keydown', windowKeys);
    try {
      render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);
      const input = screen.getByTestId('run-regions-stdin-input');
      fireEvent.change(input, { target: { value: 'Ada' } });
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      expect(useEditorStore.getState().tabs[0]!.stdinBuffer).toBe('Ada');
      expect(windowKeys).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowKeys);
    }
  });

  it('lets a click elsewhere win over the stdin focus retries', async () => {
    const fake = fakeEditor(CODE);
    const region = parseRunRegions(CODE, 'javascript')[2]!;
    useRunRegionStore.setState({ last: { tabId: 't1', region, ranAt: 9, executionTime: 1, ok: true, message: '', rows: [], request: { message: 'Name?' } } });
    render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);
    fireEvent.pointerDown(document.body);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(document.activeElement).not.toBe(screen.getByTestId('run-regions-stdin-input'));
  });

  it('shows the error of a region run that failed and offers no comment', () => {
    const fake = fakeEditor(CODE);
    const region = parseRunRegions(CODE, 'javascript')[1]!;
    const failed = { tabId: 't1', region, ranAt: 0, executionTime: null, ok: false, message: 'ReferenceError: b is not defined', rows: [] };
    useRunRegionStore.setState({ last: failed });
    render(<RunRegions editor={fake.editor as never} monaco={monaco as never} tabId="t1" language="javascript" content={CODE} />);
    expect(screen.getByTestId('run-regions-card').textContent).toContain('ReferenceError: b is not defined');
    act(() => useRunRegionStore.setState({ last: { ...failed, rows: [{ line: 3, value: 'ReferenceError: b is not defined', type: 'error' }] } }));
    expect(screen.getByTestId('run-regions-card').textContent!.match(/b is not defined/g)).toHaveLength(1);
    expect(screen.queryByTestId('run-regions-insert')).toBeNull();
  });

  it('loads only with the flag on, for a supported tab with a marker', async () => {
    const fake = fakeEditor(CODE);
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: CODE }] as never, 't1');
    const { rerender } = render(<RunRegionsHost editor={fake.editor as never} monaco={monaco as never} />);
    await act(async () => {
      await import('@/components/RunRegions/RunRegions');
    });
    expect(screen.queryByTestId('run-regions-bar')).toBeNull();

    useSettingsStore.setState({ featureFlags: { runRegions: true } });
    rerender(<RunRegionsHost editor={fake.editor as never} monaco={monaco as never} />);
    await waitFor(() => expect(screen.getByTestId('run-regions-bar')).toBeTruthy());

    useEditorStore.getState().restoreTabs([{ id: 't2', name: 'a.go', language: 'go', content: CODE }] as never, 't2');
    rerender(<RunRegionsHost editor={fake.editor as never} monaco={monaco as never} />);
    expect(screen.queryByTestId('run-regions-bar')).toBeNull();
  });
});
