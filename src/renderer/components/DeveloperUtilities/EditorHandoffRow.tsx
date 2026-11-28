import { AppWindow, ArrowDownToLine } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { openJsonTab } from '../../clipboard/applyPasteIntent';
import { useEditorStore } from '../../stores/editorStore';
import { detectsAsJson } from '../../utils/developerUtilityDetection';
import { insertIntoCodeTab, resolveInsertTarget, type InsertSource } from './editorHandoff';
import '../../i18n/clipboardChainsCatalog';

interface EditorHandoffRowProps extends InsertSource {
  readonly output: string;
  readonly ready: boolean;
  /** False while Utilities is behind another tab, so the tabs are not read then. */
  readonly active: boolean;
}

/** Insert at the last code tab's cursor, or open a JSON output as a tab of its own. */
export function EditorHandoffRow({ output, ready, active, utilityId, tool }: EditorHandoffRowProps) {
  const { t } = useTranslation();
  const target = useEditorStore(useShallow((state) => (active ? resolveInsertTarget(state.tabs) : null)));
  const json = useMemo(() => detectsAsJson(output), [output]);
  if (!target && !json) return null;
  const disabled = !ready || output.length === 0;

  return (
    <div className="editor-handoff" data-testid="utility-editor-handoff">
      {target ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => insertIntoCodeTab(target, output, { utilityId, tool })}
          data-testid="utility-insert-at-cursor"
          className="editor-handoff-button focus-ring"
        >
          <ArrowDownToLine size={13} strokeWidth={1.6} aria-hidden="true" />
          {t('utilityHandoff.insert')}
          <small className="editor-handoff-where" data-testid="utility-insert-target">
            {t('utilityHandoff.where', { tab: target.name, line: target.line })}
          </small>
        </button>
      ) : null}
      {json ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => openJsonTab(output)}
          data-testid="utility-open-json-tab"
          className="editor-handoff-button focus-ring"
        >
          <AppWindow size={13} strokeWidth={1.6} aria-hidden="true" />
          {t('paste.intent.action.importLargeJson')}
        </button>
      ) : null}
    </div>
  );
}
