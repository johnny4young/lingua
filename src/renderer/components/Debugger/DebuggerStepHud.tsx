import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import type { ShortcutId } from '../../data/keyboardShortcuts';
import { useDebuggerControls } from './useDebuggerControls';
import { useLineWidget } from '../Editor/useLineWidget';
import { DEBUGGER_HUD_HEIGHT, setStepHudLine } from './debuggerHudGeometry';
import { Glyph } from '../ui/Glyph';
import type { GlyphName } from '../ui/glyphSet';
import './stepHud.css';

const HUD_ID = 'lingua.debugger.stepHud';
/** Key caps give way first, then every label but Continue's; the tooltip and accessible name keep both. */
const HUD_FIT_STEPS = ['full', 'labels', 'glyphs'] as const;
type HudFit = (typeof HUD_FIT_STEPS)[number];
// Room kept clear of the editor's right edge.
const HUD_EDGE = 12;

export interface DebuggerStepHudProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
}

/**
 * The only step bar: a row reserved under the paused line so no code is
 * covered, and the toolbar in that row. Where and how deep the pause is lives
 * in the run meter.
 */
export function DebuggerStepHud({ editor, monaco, tabId }: DebuggerStepHudProps) {
  const { t, i18n } = useTranslation();
  const { pausedFrame, canStepOut, resume, step, runToEnd } = useDebuggerControls();
  const line = pausedFrame && pausedFrame.tabId === tabId ? pausedFrame.line : null;
  const [node] = useState(() => document.createElement('div'));
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fit = useHudFit(editor, toolbarRef, line, i18n.language);

  useEffect(() => {
    if (!editor || !monaco || line === null) return;
    let zoneId = '';
    editor.changeViewZones((accessor) => {
      // Ordinal 0 keeps this row above an answer's row under the same line.
      zoneId = accessor.addZone({ afterLineNumber: line, ordinal: 0, heightInPx: DEBUGGER_HUD_HEIGHT, domNode: document.createElement('div'), suppressMouseDown: true });
    });
    const tracker = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: {} }]);
    setStepHudLine(editor, () => tracker.getRange(0)?.startLineNumber ?? line);
    return () => {
      setStepHudLine(editor, null);
      tracker.clear();
      editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
    };
  }, [editor, monaco, line]);
  // Edits move the reserved row, so the toolbar follows the line.
  useLineWidget(editor, monaco, line, node, { id: HUD_ID, placement: 'below' });

  if (line === null) return null;
  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('debugger.hud.label')}
      data-testid="debugger-step-hud"
      data-fit={fit}
      className="debugger-hud mt-1.5 inline-flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border border-border-strong bg-bg-panel p-1 shadow-e2"
    >
      <HudButton fit={fit} primary glyph="continue" label={t('debugger.actions.continue')} hint={t('debugger.actions.continueHint')} shortcut="debugger-continue" onClick={resume} testid="debugger-hud-continue" />
      <HudButton fit={fit} glyph="stepOver" label={t('debugger.actions.stepOver')} hint={t('debugger.actions.stepOverHint')} shortcut="debugger-step-over" onClick={() => step('over')} testid="debugger-hud-step-over" />
      <HudButton fit={fit} glyph="stepInto" label={t('debugger.actions.stepInto')} hint={t('debugger.actions.stepIntoHint')} shortcut="debugger-step-into" onClick={() => step('into')} testid="debugger-hud-step-into" />
      <HudButton
        fit={fit}
        glyph="stepOut"
        label={t('debugger.actions.stepOut')}
        hint={canStepOut ? t('debugger.actions.stepOutHint') : t('debugger.actions.stepOut.disabledHint')}
        shortcut="debugger-step-out"
        onClick={() => step('out')}
        disabled={!canStepOut}
        testid="debugger-hud-step-out"
      />
      <HudButton fit={fit} glyph="runToEnd" label={t('debugger.actions.detach')} hint={t('debugger.actions.detachHint')} onClick={runToEnd} testid="debugger-hud-run-to-end" />
    </div>,
    node
  );
}

/**
 * The first step at which the toolbar fits the editor's content width. Monaco never clips a
 * content widget, so a HUD wider than a narrow editor would hang off its edge out of reach.
 */
function useHudFit(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  toolbarRef: RefObject<HTMLDivElement | null>,
  line: number | null,
  language: string
): HudFit {
  const [fit, setFit] = useState<HudFit>('full');
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!editor || !toolbar || line === null) return;
    // Height-only layouts (a dock drag) skip the reflows; a new locale or line measures again.
    let lastWidth = -1;
    const measure = () => {
      const width = editor.getLayoutInfo().contentWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const room = width - HUD_EDGE;
      const step =
        HUD_FIT_STEPS.find(candidate => {
          toolbar.dataset.fit = candidate;
          return toolbar.offsetWidth <= room;
        }) ?? 'glyphs';
      toolbar.dataset.fit = step;
      setFit(step);
    };
    measure();
    const layout = editor.onDidLayoutChange(measure);
    return () => layout.dispose();
  }, [editor, toolbarRef, line, language]);
  return fit;
}

function HudButton({
  fit,
  glyph,
  label,
  hint,
  shortcut,
  onClick,
  disabled = false,
  primary = false,
  testid,
}: {
  fit: HudFit;
  glyph: GlyphName;
  label: string;
  hint: string;
  shortcut?: ShortcutId;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  testid: string;
}) {
  const keyLabel = useShortcutLabel(shortcut);
  // A folded button names itself, and its key, in the tooltip.
  const title = fit === 'full' ? hint : `${label}${keyLabel ? ` (${keyLabel})` : ''} · ${hint}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      data-primary={primary || undefined}
      className={`debugger-hud-button focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-caption font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        primary ? 'bg-pulse text-pulse-on hover:brightness-110' : 'text-fg-base hover:bg-bg-inset'
      }`}
    >
      <Glyph name={glyph} size={14} />
      <span className="debugger-hud-label">{label}</span>
      {keyLabel ? (
        <kbd
          className={`debugger-hud-key rounded-sm px-1 font-mono text-micro ${
            primary ? 'bg-black/15 text-pulse-on' : 'border border-border-subtle bg-bg-inset text-fg-muted'
          }`}
        >
          {keyLabel}
        </kbd>
      ) : null}
    </button>
  );
}
