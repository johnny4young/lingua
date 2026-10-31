import { useEffect } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';

/** While the Timeline tab is open, the editor highlights the selected step's line. */
export function TimelineLineHost({
  editor,
  monaco,
  tabId,
}: {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
}) {
  const on = useSettingsStore(state => state.featureFlags.runTimeline === true);
  const open = useUIStore(state => state.consoleVisible && state.activeBottomPanel === 'timeline');
  const line = useTimelineStore(state =>
    state.recording && state.recording.tabId === tabId ? (state.recording.steps[state.current]?.line ?? null) : null
  );

  useEffect(() => {
    if (!editor || !monaco || !on || !open || line === null) return;
    const decorations = editor.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'lingua-timeline-line' } },
    ]);
    editor.revealLineInCenterIfOutsideViewport(line);
    return () => decorations.clear();
  }, [editor, monaco, on, open, line]);

  return null;
}
