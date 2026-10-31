import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as monacoTypes from 'monaco-editor';
import '../../i18n/timelineCatalog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { timelineEchoes, timelineLineChanges, timelineUnreachedLines } from '../../utils/timelineModel';

const FLASH_MS = 600;

/**
 * While the Timeline tab is open, the editor shows the selected step: its
 * line, what the line changed, which run of the line it is, and the lines the
 * run has not reached yet. A move with nowhere to go flashes the line red.
 */
export function TimelineLineHost({
  editor,
  monaco,
  tabId,
}: {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
}) {
  const { t } = useTranslation();
  const on = useSettingsStore(state => state.featureFlags.runTimeline === true);
  const open = useUIStore(state => state.consoleVisible && state.activeBottomPanel === 'timeline');
  const steps = useTimelineStore(state => (state.recording && state.recording.tabId === tabId ? state.recording.steps : null));
  const current = useTimelineStore(state => state.current);
  const blocked = useTimelineStore(state => state.blocked);
  const [flashing, setFlashing] = useState(false);
  const [seenBlocked, setSeenBlocked] = useState(blocked);

  if (blocked !== seenBlocked) {
    setSeenBlocked(blocked);
    setFlashing(true);
  }
  useEffect(() => {
    if (!flashing) return;
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashing, blocked]);

  const view = useMemo(() => {
    const step = steps?.[current];
    if (!steps || !step || step.line <= 0) return null;
    const echoes = timelineEchoes(steps, current);
    return {
      line: step.line,
      changes: timelineLineChanges(steps, current)
        .slice(0, 2)
        .map(([name, value]) => `${name} = ${value}`)
        .join(', '),
      echo: echoes.indices.length > 1 ? t('timeline.echoPill', { position: echoes.position, count: echoes.indices.length }) : '',
      unreached: timelineUnreachedLines(steps, current),
    };
  }, [steps, current, t]);

  useEffect(() => {
    const model = editor?.getModel();
    if (!editor || !monaco || !model || !on || !open || !view) return;
    const lineCount = model.getLineCount();
    if (view.line > lineCount) return;
    const end = model.getLineMaxColumn(view.line);
    // Monaco skips injected text on an empty range, so the pills ride the last character.
    const at = new monaco.Range(view.line, Math.max(1, end - 1), view.line, end);
    const decorations: monacoTypes.editor.IModelDeltaDecoration[] = [
      {
        range: new monaco.Range(view.line, 1, view.line, 1),
        options: { isWholeLine: true, className: flashing ? 'lingua-timeline-line lingua-timeline-blocked' : 'lingua-timeline-line' },
      },
      ...(view.changes ? [{ range: at, options: { after: { content: view.changes, inlineClassName: 'lingua-timeline-value' } } }] : []),
      ...(view.echo ? [{ range: at, options: { after: { content: view.echo, inlineClassName: 'lingua-timeline-echo' } } }] : []),
      ...view.unreached
        .filter(line => line <= lineCount)
        .map(line => ({
          range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
          options: { inlineClassName: 'lingua-timeline-unreached' },
        })),
    ];
    const collection = editor.createDecorationsCollection(decorations);
    editor.revealLineInCenterIfOutsideViewport(view.line);
    return () => collection.clear();
  }, [editor, monaco, on, open, view, flashing]);

  return null;
}
