import { useTranslation } from 'react-i18next';
import { detectPaletteIntent, type PaletteIntent } from '../../../shared/paletteIntent';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useEntitlement } from '../../hooks/useEntitlement';
import { getActiveEditor } from '../../runtime/editorAccess';
import { openExplainCodeForEditor } from '../../stores/aiExplainCodeStore';
import { useConsoleStore } from '../../stores/consoleStore';
import { isWorkspaceTab } from '../../stores/editorTabUtils';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { CommandEntry } from './commandPaletteModelTypes';

/** The program's output and error in the tab's last run; nothing when the results belong to another tab. */
function lastRunText(tabId: string): string | undefined {
  const { ranCode, error } = useResultStore.getState();
  if (ranCode?.tabId !== tabId) return undefined;
  // Lingua's own status rows (Running…, Completed in…) are info rows with no line or payload.
  const lines = useConsoleStore
    .getState()
    .entries.filter(entry => entry.type !== 'info' || entry.line !== undefined || entry.payload !== undefined)
    .map(entry => entry.content);
  if (error?.message) lines.push(`Error: ${error.message}`);
  const text = lines.join('\n').trim();
  return text || undefined;
}

export interface PaletteAutodetect {
  intent: PaletteIntent;
  /** The row that acts on the detected intent, shown above the commands. */
  entry: CommandEntry | null;
}

/** Labs › Palette autodetect: a question goes to Explain this code, a file name to Quick Open. */
export function usePaletteAutodetect(
  query: string,
  { enabled, onOpenQuickOpen, onClose }: { enabled: boolean; onOpenQuickOpen?: (query: string) => void; onClose: () => void }
): PaletteAutodetect {
  const { t } = useTranslation();
  const flag = useSettingsStore(state => state.featureFlags.paletteAutodetect === true);
  const entitled = useEntitlement('LOCAL_AI');
  const activeTab = useActiveTab();
  if (!enabled || !flag) return { intent: { kind: 'command', query }, entry: null };
  const intent = detectPaletteIntent(query);

  if (intent.kind === 'question' && entitled && activeTab && !isWorkspaceTab(activeTab)) {
    const entry: CommandEntry = {
      id: 'autodetect-question',
      category: 'action',
      label: t('commandPalette.autodetect.ask.label', { query: intent.query }),
      description: t('commandPalette.autodetect.ask.description'),
      showDescription: true,
      keywords: [],
      action: () => {
        const editor = getActiveEditor();
        if (editor) {
          const lastRun = lastRunText(activeTab.id);
          openExplainCodeForEditor(editor, activeTab.language, activeTab.name, { question: intent.query, ...(lastRun ? { lastRun } : {}) });
        }
        onClose();
      },
    };
    return { intent, entry };
  }
  if (intent.kind === 'file' && onOpenQuickOpen) {
    const entry: CommandEntry = {
      id: 'autodetect-file',
      category: 'action',
      label: t('commandPalette.autodetect.file.label', { query: intent.query }),
      description: '',
      keywords: [],
      action: () => onOpenQuickOpen(intent.query),
    };
    return { intent, entry };
  }
  return { intent: { kind: 'command', query: intent.query }, entry: null };
}
