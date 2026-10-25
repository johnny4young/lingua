import { ArrowDownToDot, ArrowUpFromDot, ChevronsRight, Redo, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import type { ShortcutId } from '../../data/keyboardShortcuts';
import { useDebuggerControls } from './useDebuggerControls';

const HUD_HEIGHT = 38;
const HUD_ID = 'lingua.debugger.stepHud';

export interface DebuggerStepHudProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string | null;
}

/**
 * The step controls under the paused line: a row reserved below it so no code
 * is covered, and a toolbar in that row.
 */
export function DebuggerStepHud({ editor, monaco, tabId }: DebuggerStepHudProps) {
  const { t } = useTranslation();
  const { pausedFrame, canStepOut, resume, step, runToEnd } = useDebuggerControls();
  const line = pausedFrame && pausedFrame.tabId === tabId ? pausedFrame.line : null;
  const [node] = useState(() => document.createElement('div'));

  useEffect(() => {
    if (!editor || !monaco || line === null) return;
    let zoneId = '';
    editor.changeViewZones((accessor) => {
      zoneId = accessor.addZone({ afterLineNumber: line, heightInPx: HUD_HEIGHT, domNode: document.createElement('div'), suppressMouseDown: true });
    });
    const widget: monacoTypes.editor.IContentWidget = {
      getId: () => HUD_ID,
      getDomNode: () => node,
      getPosition: () => ({
        position: { lineNumber: line, column: 1 },
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    };
    editor.addContentWidget(widget);
    return () => {
      editor.removeContentWidget(widget);
      editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
    };
  }, [editor, monaco, line, node]);

  if (line === null) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label={t('debugger.hud.label')}
      data-testid="debugger-step-hud"
      className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border-strong bg-bg-panel p-1 shadow-e2"
    >
      <span className="mx-1 rounded-sm bg-accent-tint px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent-fg">
        {t('debugger.hud.paused', { line })}
      </span>
      <HudButton icon={ChevronsRight} label={t('debugger.actions.continue')} hint={t('debugger.actions.continueHint')} shortcut="debugger-continue" onClick={resume} testid="debugger-hud-continue" />
      <HudButton icon={Redo} label={t('debugger.actions.stepOver')} hint={t('debugger.actions.stepOverHint')} shortcut="debugger-step-over" onClick={() => step('over')} testid="debugger-hud-step-over" />
      <HudButton icon={ArrowDownToDot} label={t('debugger.actions.stepInto')} hint={t('debugger.actions.stepIntoHint')} shortcut="debugger-step-into" onClick={() => step('into')} testid="debugger-hud-step-into" />
      <HudButton
        icon={ArrowUpFromDot}
        label={t('debugger.actions.stepOut')}
        hint={canStepOut ? t('debugger.actions.stepOutHint') : t('debugger.actions.stepOut.disabledHint')}
        shortcut="debugger-step-out"
        onClick={() => step('out')}
        disabled={!canStepOut}
        testid="debugger-hud-step-out"
      />
      <HudButton icon={Zap} label={t('debugger.actions.detach')} hint={t('debugger.actions.detachHint')} onClick={runToEnd} testid="debugger-hud-run-to-end" />
    </div>,
    node
  );
}

function HudButton({
  icon: Icon,
  label,
  hint,
  shortcut,
  onClick,
  disabled = false,
  testid,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  shortcut?: ShortcutId;
  onClick: () => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-subtle bg-bg-panel px-2 text-caption font-medium text-fg-base hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon size={12} aria-hidden="true" />
      {label}
      {shortcut ? <HudKey id={shortcut} /> : null}
    </button>
  );
}

function HudKey({ id }: { id: ShortcutId }) {
  const label = useShortcutLabel(id);
  if (!label) return null;
  return (
    <kbd className="rounded-sm border border-border-subtle bg-bg-inset px-1 font-mono text-micro text-fg-muted">{label}</kbd>
  );
}
