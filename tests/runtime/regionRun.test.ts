import { afterEach, describe, expect, it } from 'vitest';
import { regionRunAtCursor, regionRunOptions } from '@/runtime/regionRun';
import { setActiveEditor } from '@/runtime/editorAccess';
import { useEditorStore } from '@/stores/editorStore';
import { useRunRegionStore } from '@/stores/runRegionStore';
import { useSettingsStore } from '@/stores/settingsStore';

const CODE = ['const a = 1;', '// %% second', 'console.log(a);'].join('\n');
const initialSettings = useSettingsStore.getState();

function focusEditor(line: number, focused = true) {
  setActiveEditor({ getPosition: () => ({ lineNumber: line, column: 1 }), hasTextFocus: () => focused } as never);
}

afterEach(() => {
  setActiveEditor(null);
  useSettingsStore.setState(initialSettings, true);
  useRunRegionStore.setState({ last: null, masked: {} });
});

describe('region run at the cursor', () => {
  it('runs the region at the cursor of a focused editor, with the masked answers of its tab', async () => {
    useSettingsStore.setState({ featureFlags: { runRegions: true } });
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: CODE }] as never, 't1');
    useRunRegionStore.setState({ masked: { t1: { input: '', content: CODE, answers: [{ index: 0, value: 's' }] } } });
    focusEditor(3);
    const options = await regionRunAtCursor();
    expect(options).toEqual({
      region: { index: 1, name: 'second', markerLine: 2, startLine: 2, endLine: 3 },
      maskedStdin: [{ index: 0, value: 's' }],
    });
    expect(regionRunOptions('t2', options!.region!)).toMatchObject({ maskedStdin: [] });
    useEditorStore.getState().setTabStdinBuffer('t1', 'edited');
    expect((await regionRunAtCursor())?.maskedStdin).toEqual([]);
    focusEditor(1);
    useEditorStore.getState().restoreTabs([{ id: 't4', name: 'c.js', language: 'javascript', content: '\n// %% only\nx;' }] as never, 't4');
    expect(await regionRunAtCursor()).toBeUndefined();
  });

  it('leaves the Run shortcut alone with the flag off, outside the editor, in other languages or without markers', () => {
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: CODE }] as never, 't1');
    focusEditor(3);
    expect(regionRunAtCursor()).toBeUndefined();
    useSettingsStore.setState({ featureFlags: { runRegions: true } });
    focusEditor(3, false);
    expect(regionRunAtCursor()).toBeUndefined();
    focusEditor(3);
    useEditorStore.getState().restoreTabs([{ id: 't2', name: 'a.go', language: 'go', content: CODE }] as never, 't2');
    expect(regionRunAtCursor()).toBeUndefined();
    useEditorStore.getState().restoreTabs([{ id: 't3', name: 'b.js', language: 'javascript', content: 'const a = 1;' }] as never, 't3');
    expect(regionRunAtCursor()).toBeUndefined();
  });
});
