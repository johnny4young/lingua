import type * as monacoTypes from 'monaco-editor';
import { vi } from 'vitest';

/** A Monaco stand-in that mounts content widgets into the document and records view zones. */
export function fakeEditor(options: { lines?: string[]; contentWidth?: number } = {}) {
  const lines = options.lines ?? Array.from({ length: 20 }, () => 'x');
  const node = document.createElement('div');
  const zones: Array<{ afterLineNumber: number; heightInPx: number }> = [];
  const widgets: monacoTypes.editor.IContentWidget[] = [];
  let keyListener: ((event: { browserEvent: KeyboardEvent }) => void) | null = null;
  const disposable = { dispose: vi.fn() };
  const editor = {
    getModel: () => ({
      getLineCount: () => lines.length,
      getLineMaxColumn: (line: number) => (lines[line - 1]?.length ?? 0) + 1,
      getOptions: () => ({ tabSize: 2 }),
    }),
    getDomNode: () => node,
    getOption: (option: number) => (option === 1 ? 20 : { typicalHalfwidthCharacterWidth: 8 }),
    getOffsetForColumn: (_line: number, column: number) => (column - 1) * 8,
    getScrollLeft: () => 0,
    changeViewZones: (callback: (accessor: { addZone: (zone: never) => string; removeZone: (id: string) => void }) => void) =>
      callback({
        addZone: zone => {
          zones.push(zone);
          return String(zones.length);
        },
        removeZone: id => zones.splice(Number(id) - 1, 1, { afterLineNumber: -1, heightInPx: 0 }),
      }),
    createDecorationsCollection: vi.fn(() => ({ clear: vi.fn(), getRange: () => null })),
    addContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.push(widget);
      document.body.appendChild(widget.getDomNode());
    },
    removeContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.splice(widgets.indexOf(widget), 1);
      widget.getDomNode().remove();
    },
    layoutContentWidget: vi.fn(),
    onDidChangeModelContent: () => disposable,
    onDidLayoutChange: () => disposable,
    onDidScrollChange: () => disposable,
    onDidChangeConfiguration: () => disposable,
    getLayoutInfo: () => ({ contentWidth: options.contentWidth ?? 1200 }),
    onKeyDown: (listener: typeof keyListener) => {
      keyListener = listener;
      return disposable;
    },
  };
  const monaco = {
    Range: class {
      constructor(public startLineNumber: number) {}
    },
    editor: {
      ContentWidgetPositionPreference: { BELOW: 2, EXACT: 0 },
      EditorOption: { lineHeight: 1, fontInfo: 2 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      // Like Monaco: one keyword token, then the rest, with spaces as non-breaking.
      colorize: vi.fn(async (text: string) => {
        const line = (source: string) => {
          const [, word = '', rest = ''] = /^(\S*)(.*)$/su.exec(source.trimStart()) ?? [];
          const indent = source.slice(0, source.length - source.trimStart().length).replace(/ /gu, '&nbsp;');
          return `<span><span class="mtk1">${indent}</span><span class="mtk6 mtki">${word}</span><span class="mtk1">${rest.replace(/>/gu, '&gt;')}</span></span><br/>`;
        };
        return `<div class="monaco-tokenized-source">${text.split('\n').map(line).join('')}</div>`;
      }),
    },
  };
  return {
    editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor,
    monaco: monaco as unknown as typeof monacoTypes,
    node,
    zones,
    activeZones: () => zones.filter(zone => zone.afterLineNumber > 0),
    widgets,
    pressEscape: () => keyListener?.({ browserEvent: new KeyboardEvent('keydown', { key: 'Escape' }) }),
  };
}
