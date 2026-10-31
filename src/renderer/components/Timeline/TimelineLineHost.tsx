import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as monacoTypes from 'monaco-editor';
import '../../i18n/timelineCatalog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { timelineEchoes, timelineLineChanges, timelineUnreachedLines } from '../../utils/timelineModel';

const FLASH_MS = 600;
// Bidi overrides and C0 controls from recorded values would reorder or break the pill.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;

/**
 * While the Timeline tab is open, the editor shows the selected step: its
 * line, what the line changed, which run of the line it is, and the lines the
 * run reaches later. A move with nowhere to go flashes the line red.
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
  const stepDecorations = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

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
        .map(([name, value]) => `${name} = ${value}`.replace(UNSAFE_TEXT, ' '))
        .join(', '),
      echo: echoes.indices.length > 1 ? t('timeline.echoPill', { position: echoes.position, count: echoes.indices.length }) : '',
      unreached: timelineUnreachedLines(steps, current),
    };
  }, [steps, current, t]);
  const active = Boolean(editor && monaco && on && open && view);

  // One collection, updated in place as the step moves.
  useEffect(() => {
    const model = editor?.getModel();
    if (!editor || !monaco || !model || !active || !view || view.line > model.getLineCount()) {
      stepDecorations.current?.clear();
      return;
    }
    const end = model.getLineMaxColumn(view.line);
    const at = new monaco.Range(view.line, end, view.line, end);
    const decorations: monacoTypes.editor.IModelDeltaDecoration[] = [
      { range: new monaco.Range(view.line, 1, view.line, 1), options: { isWholeLine: true, className: 'lingua-timeline-line' } },
      ...(view.changes
        ? [{ range: at, options: { after: { content: view.changes, inlineClassName: 'lingua-timeline-value' }, showIfCollapsed: true } }]
        : []),
      ...(view.echo
        ? [{ range: at, options: { after: { content: view.echo, inlineClassName: 'lingua-timeline-echo' }, showIfCollapsed: true } }]
        : []),
      ...view.unreached
        .filter(line => line <= model.getLineCount())
        .map(line => ({
          range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
          options: { inlineClassName: 'lingua-timeline-unreached' },
        })),
    ];
    if (stepDecorations.current) stepDecorations.current.set(decorations);
    else stepDecorations.current = editor.createDecorationsCollection(decorations);
    editor.revealLineInCenterIfOutsideViewport(view.line);
  }, [editor, monaco, active, view]);

  useEffect(() => () => stepDecorations.current?.clear(), []);

  // The flash lives apart so it does not rebuild the step's decorations.
  useEffect(() => {
    if (!editor || !monaco || !active || !view || !flashing) return;
    const flash = editor.createDecorationsCollection([
      { range: new monaco.Range(view.line, 1, view.line, 1), options: { isWholeLine: true, className: 'lingua-timeline-blocked' } },
    ]);
    return () => flash.clear();
  }, [editor, monaco, active, view, flashing]);

  return null;
}
