import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Language } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { languageBadgeTone } from '../../utils/languageMeta';

interface FileTreeOpenTabsProps {
  /**
   * Fired after a tab is selected so the caller can close a mobile
   * drawer / navigate. The store write (`setActiveTab`) is owned here.
   */
  onNavigate?: () => void;
}

/**
 * PERF-001 — the open-tabs foot is the only part of the explorer that
 * legitimately needs the tab list, but it only needs a *projection* of
 * it (id / name / language / isDirty + the active id), never the tab
 * `content`. Subscribing to a derived projection through `useShallow`
 * means a per-keystroke `content` update — which rewrites the whole
 * `tabs` array — does NOT re-render this component (the projection is
 * shallow-equal), so editor typing no longer churns the explorer. The
 * recursive `FileTreeNode` body subscribes to none of this.
 *
 * FASE 4 — Explorer (ADD.A). Shared "Pestañas abiertas" foot rendered
 * identically by BOTH the no-project empty state and the project view,
 * mirroring the proto (`proto-explorer.jsx`) where the open-tabs list
 * is present in every explorer state.
 *
 * Each row leads with the canonical colored mono glyph badge driven by
 * `languageBadgeTone` (same tone object the editor tab strip and the
 * action pill render), then the file name, then a dirty dot. Self-
 * renders to `null` when there are no open tabs so callers can mount it
 * unconditionally.
 */
interface OpenTabSummary {
  readonly id: string;
  readonly name: string;
  readonly language: Language;
  readonly isDirty: boolean;
}

/**
 * PERF-001 — encode each tab's rendered fields as a single string so
 * `useShallow` (which compares array elements with `Object.is`) treats
 * an unchanged projection as equal. A naive `.map(tab => ({...}))`
 * mints fresh objects every render, which `Object.is` always reports as
 * different, looping the subscription. Strings of identical content are
 * `Object.is`-equal, so a per-keystroke `content` mutation — which does
 * NOT touch id / name / language / isDirty — yields an unchanged string
 * array and skips the re-render.
 */
function encodeOpenTab(tab: {
  id: string;
  name: string;
  language: Language;
  isDirty: boolean;
}): string {
  return JSON.stringify([tab.id, tab.name, tab.language, tab.isDirty]);
}

function decodeOpenTab(encoded: string): OpenTabSummary {
  const [id, name, language, isDirty] = JSON.parse(encoded) as [
    string,
    string,
    Language,
    boolean,
  ];
  return { id, name, language, isDirty };
}

export function FileTreeOpenTabs({ onNavigate }: FileTreeOpenTabsProps) {
  const { t } = useTranslation();
  // Narrowed projection — only the fields the foot renders, encoded as
  // value-comparable strings so `useShallow` short-circuits on a
  // keystroke that only changed tab `content`.
  const encodedTabs = useEditorStore(
    useShallow((state) => state.tabs.map(encodeOpenTab))
  );
  const tabs = encodedTabs.map(decodeOpenTab);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  // Zustand actions are stable references — selecting one never causes a
  // re-render, so we read it directly rather than via `getState()`.
  const setActiveTab = useEditorStore((state) => state.setActiveTab);

  if (tabs.length === 0) return null;

  return (
    <div className="border-t border-border/70">
      <div className="flex h-9 items-center gap-1.5 px-4">
        <span className="panel-title">{t('fileTree.emptyState.openTabs')}</span>
      </div>
      <div className="p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              onNavigate?.();
            }}
            aria-label={
              tab.isDirty
                ? `${tab.name} · ${t('fileTree.dirtyDot.label')}`
                : tab.name
            }
            className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
              tab.id === activeTabId
                ? 'bg-surface-strong/88 text-foreground'
                : 'text-muted hover:bg-surface-strong/62 hover:text-foreground'
            }`}
          >
            <OpenTabGlyph language={tab.language} />
            <span className="truncate">{tab.name}</span>
            {tab.isDirty && (
              <span
                role="img"
                aria-label={t('fileTree.dirtyDot.label')}
                className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Colored filled mono glyph badge (proto lines 59-60 / 70). Renders the
 * `languageBadgeTone` triple via inline `style` — the tone backgrounds
 * are theme tokens / oklch pairs owned by `languageMeta`, the same way
 * `EditorTabs` and `FloatingActionPill` consume them. No hardcoded
 * color lives here.
 */
function OpenTabGlyph({ language }: { language: Language }) {
  const tone = languageBadgeTone(language);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono text-[8px] font-bold uppercase leading-none"
      style={{
        minWidth: 16,
        height: 16,
        padding: '0 3px',
        letterSpacing: '0.04em',
        background: tone.background,
        color: tone.foreground,
      }}
    >
      {tone.code}
    </span>
  );
}
