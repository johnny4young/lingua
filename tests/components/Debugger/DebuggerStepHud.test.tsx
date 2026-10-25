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
  const editor = {
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
  };
}

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
    expect(fake.zones).toEqual([expect.objectContaining({ afterLineNumber: 3, heightInPx: 38 })]);
    expect(fake.widgets[0]?.getPosition()).toEqual({ position: { lineNumber: 3, column: 1 }, preference: [2] });
    expect(screen.getByRole('toolbar', { name: 'Debugger controls' }).textContent).toContain('Paused · line 3');
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

  it('follows the paused line when an edit above it moves the row', () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t1" />);
    pause(3);
    fake.trackedLine.current = 4;
    act(() => fake.edit.current?.());
    expect(fake.editor.layoutContentWidget).toHaveBeenCalledTimes(1);
    expect(fake.widgets[0]?.getPosition()?.position).toEqual({ lineNumber: 4, column: 1 });
  });

  it('stays away from another tab', () => {
    const fake = fakeEditor();
    render(<DebuggerStepHud editor={fake.editor} monaco={fake.monaco} tabId="t2" />);
    pause(3);
    expect(fake.zones).toHaveLength(0);
    expect(screen.queryByTestId('debugger-step-hud')).toBeNull();
  });
});
