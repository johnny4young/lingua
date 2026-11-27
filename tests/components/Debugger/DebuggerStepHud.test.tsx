import { DEBUGGER_HUD_HEIGHT, stepHudLine } from '@/components/Debugger/debuggerHudGeometry';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import type * as monacoTypes from 'monaco-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { DebuggerStepHud } from '@/components/Debugger/DebuggerStepHud';
import { postDebuggerMessage } from '@/runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';

vi.mock('@/runtime/debuggerWorkerBridge', () => ({ postDebuggerMessage: vi.fn(() => true) }));

function fakeEditor() {
  const zones: { afterLineNumber: number; heightInPx?: number }[] = [];
  const widgets: monacoTypes.editor.IContentWidget[] = [];
  const trackedLine: { current: number | null } = { current: null };
  const edit: { current: (() => void) | null } = { current: null };
  const layout: { width: number; changed: (() => void) | null } = { width: 1200, changed: null };
  const editor = {
    getLayoutInfo: () => ({ contentWidth: layout.width }),
    onDidLayoutChange: (handler: () => void) => {
      layout.changed = handler;
      return { dispose: vi.fn() };
    },
    changeViewZones: (callback: (accessor: { addZone: (zone: never) => string; removeZone: (id: string) => void }) => void) =>
      callback({
        addZone: (zone: never) => {
          zones.push(zone);
          return String(zones.length);
        },
        removeZone: () => zones.pop(),
      }),
    addContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.push(widget);
      document.body.appendChild(widget.getDomNode());
    },
    getModel: () => ({ getLineCount: () => 20, getLineMaxColumn: () => 1 }),
    createDecorationsCollection: () => ({ getRange: () => ({ startLineNumber: trackedLine.current ?? 0 }), clear: vi.fn() }),
    onDidChangeModelContent: (handler: () => void) => {
      edit.current = handler;
      return { dispose: vi.fn() };
    },
    layoutContentWidget: vi.fn(),
    removeContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.splice(widgets.indexOf(widget), 1);
      widget.getDomNode().remove();
    },
  };
  const monaco = {
    Range: class {
      constructor(public startLineNumber: number) {
        trackedLine.current = startLineNumber;
      }
    },
    editor: { ContentWidgetPositionPreference: { BELOW: 2 } },
  };
  return {
    editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor,
    monaco: monaco as unknown as typeof monacoTypes,
    zones,
    widgets,
    trackedLine,
    edit,
    layout,
  };
}

// jsdom lays nothing out: the toolbar reports the width each fit step would take.
const STEP_WIDTHS: Record<string, number> = { full: 596, labels: 470, glyphs: 210 };

const pause = (line: number, callStack: { functionName: string; line: number }[] = []) =>
  act(() => useDebuggerStore.getState().setPausedFrame({ tabId: 't1', line, reason: 'step', locals: {}, callStack, watchResults: {} }));

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  vi.mocked(postDebuggerMessage).mockClear();
  useDebuggerStore.setState({ session: { runtime: 'js', tabId: 't1', attachedAt: 1 }, pausedFrame: null, previousPause: null, lastPause: null });
});

describe('step HUD', () => {
  it('reserves a row under the paused line and sits in it', () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
    expect(fake.zones).toHaveLength(0);
    pause(3);
    expect(fake.zones).toEqual([expect.objectContaining({ afterLineNumber: 3, ordinal: 0, heightInPx: DEBUGGER_HUD_HEIGHT })]);
    expect(fake.widgets[0]?.getPosition()).toEqual({ position: { lineNumber: 3, column: 1 }, preference: [2] });
    const toolbar = screen.getByRole('toolbar', { name: 'Debugger controls' });
    // The run meter says where the run is held; the HUD only steps, with Continue as its primary action.
    expect(toolbar.textContent).not.toContain('line 3');
    expect(screen.getByTestId('debugger-hud-continue').dataset.primary).toBe('true');
    expect(toolbar.querySelectorAll('button')).toHaveLength(5);
  });

  it('steps from the HUD and only offers Step out inside a function', async () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
    pause(3);
    expect(screen.getByTestId('debugger-hud-step-out').hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByTestId('debugger-hud-step-over'));
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
    expect(fake.zones).toHaveLength(0);
    pause(7, [{ functionName: 'double', line: 7 }]);
    expect(screen.getByTestId('debugger-hud-step-out').hasAttribute('disabled')).toBe(false);
  });

  it('runs to the end by clearing breakpoints before resuming', async () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
    pause(3);
    vi.mocked(postDebuggerMessage).mockClear();
    await userEvent.click(screen.getByTestId('debugger-hud-run-to-end'));
    expect(postDebuggerMessage).toHaveBeenNthCalledWith(1, { type: 'set-breakpoints', breakpoints: [] });
    expect(postDebuggerMessage).toHaveBeenNthCalledWith(2, { type: 'resume' });
    expect(useDebuggerStore.getState().session).toBeNull();
  });

  it('follows the paused line when an edit above it moves the row', () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
    pause(3);
    fake.trackedLine.current = 4;
    act(() => fake.edit.current?.());
    expect(fake.editor.layoutContentWidget).toHaveBeenCalledTimes(1);
    expect(fake.widgets[0]?.getPosition()?.position).toEqual({ lineNumber: 4, column: 1 });
    // Answers placed under a line read where the HUD row sits now, not the paused frame's line.
    expect(stepHudLine(fake.editor)).toBe(4);
    act(() => useDebuggerStore.getState().setPausedFrame(null));
    expect(stepHudLine(fake.editor)).toBeNull();
  });

  it('folds to fit a narrow editor: key caps first, then every label but Continue', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.isConnected ? (STEP_WIDTHS[this.dataset.fit ?? ''] ?? 0) : 0;
    });
    try {
      const fake = fakeEditor();
      fake.layout.width = 1200;
      render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
      pause(3);
      const toolbar = screen.getByTestId('debugger-step-hud');
      expect(toolbar.dataset.fit).toBe('full');
      expect(screen.getByTestId('debugger-hud-step-over').title).toBe('Run the current line and pause on the next line in this frame.');

      act(() => {
        fake.layout.width = 500;
        fake.layout.changed?.();
      });
      expect(toolbar.dataset.fit).toBe('labels');

      act(() => {
        fake.layout.width = 320;
        fake.layout.changed?.();
      });
      expect(toolbar.dataset.fit).toBe('glyphs');
      // A glyph-only button keeps its name, and the tooltip names it with its key.
      const stepOver = screen.getByRole('button', { name: 'Step over F10' });
      expect(stepOver.title).toBe('Step over (F10) · Run the current line and pause on the next line in this frame.');
      expect(screen.getByRole('button', { name: 'Run to end' }).title).toBe('Run to end · Continue without stopping at more breakpoints.');
      expect(screen.getByTestId('debugger-hud-continue').dataset.primary).toBe('true');
    } finally {
      width.mockRestore();
    }
  });

  it('folds when it pauses in an editor that is already narrow, and again after a step', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.isConnected ? (STEP_WIDTHS[this.dataset.fit ?? ''] ?? 0) : 0;
    });
    try {
      const fake = fakeEditor();
      fake.layout.width = 320;
      render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
      pause(3);
      expect(screen.getByTestId('debugger-step-hud').dataset.fit).toBe('glyphs');
      await userEvent.click(screen.getByTestId('debugger-hud-step-over'));
      pause(4);
      expect(screen.getByTestId('debugger-step-hud').dataset.fit).toBe('glyphs');
    } finally {
      width.mockRestore();
    }
  });

  it('stays away from another tab', () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t2" />);
    pause(3);
    expect(fake.zones).toHaveLength(0);
    expect(screen.queryByTestId('debugger-step-hud')).toBeNull();
  });
});
