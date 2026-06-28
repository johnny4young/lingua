import { BookCopy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import type { Language } from '../../types';
import {
  extensionForLanguage,
  languageCapabilityBadgeKey,
  languageLabel,
} from '../../utils/languageMeta';
import { ModalShell } from '../ui/ModalShell';

interface SnippetsModalProps {
  onClose: () => void;
}

interface SnippetDraft {
  label: string;
  description: string;
  language: Language;
  code: string;
}

const EMPTY_SNIPPET_DRAFT: SnippetDraft = {
  label: '',
  description: '',
  language: 'javascript',
  code: '',
};

// RL-038 Slice C closeout — pull the runnable language set from the
// shared `LANGUAGE_PACKS` registry instead of a hardcoded list. Walking
// the registry means future languages added to `src/shared/languagePacks.ts`
// surface in the snippet picker automatically. We keep the picker
// scoped to `run` / `compile` packs because saving a snippet of a
// view-only pack (json, dockerfile, gitignore, ...) is rarely useful;
// users typing real code into Lingua are working in a runnable pack.
const SNIPPET_LANGUAGE_PACKS = LANGUAGE_PACKS.filter(
  (pack) => pack.execution === 'run' || pack.execution === 'compile'
);

/**
 * Strip a file extension from a tab name and fall back to a localized
 * default when the remainder is empty.
 */
function trimTabName(tabName: string, fallback: string): string {
  const trimmedName = tabName.replace(/\.[^.]+$/, '').trim();
  return trimmedName.length > 0 ? trimmedName : fallback;
}

function createDraftFromActiveTab(
  activeTab: { name: string; language: Language; content: string } | undefined,
  t: TFunction
): SnippetDraft {
  if (!activeTab) {
    return EMPTY_SNIPPET_DRAFT;
  }

  return {
    label: trimTabName(activeTab.name, t('snippets.draft.defaultName')),
    description: t('snippets.draft.descriptionFromTab', { name: activeTab.name }),
    language: activeTab.language,
    code: activeTab.content,
  };
}

export function SnippetsModal({ onClose }: SnippetsModalProps) {
  const {
    snippets,
    pendingLinkedSnippetId,
    addSnippet,
    removeSnippet,
    updateSnippet,
    setPendingLinkedSnippetId,
  } = useSnippetsStore();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const addTab = useEditorStore((state) => state.addTab);
  const updateContent = useEditorStore((state) => state.updateContent);
  const { t } = useTranslation();
  // Same platform-gating idiom Toolbar / FileTree use — only the web
  // build surfaces the "(desktop only)" hint; on packaged Electron the
  // language is genuinely runnable so the suffix would be misleading.
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(
    snippets[0]?.id ?? null
  );
  const [draft, setDraft] = useState<SnippetDraft>(EMPTY_SNIPPET_DRAFT);
  const [isCreatingNew, setIsCreatingNew] = useState(snippets.length === 0);

  const sortedSnippets = useMemo(
    () => [...snippets].sort((left, right) => right.createdAt - left.createdAt),
    [snippets]
  );
  const selectedSnippet =
    sortedSnippets.find((snippet) => snippet.id === selectedSnippetId) ?? null;
  const activeTab = useActiveTab();
  const canSaveSnippet = draft.label.trim().length > 0 && draft.code.trim().length > 0;

  useEffect(() => {
    if (isCreatingNew) {
      return;
    }

    if (selectedSnippet) {
      setDraft({
        label: selectedSnippet.label,
        description: selectedSnippet.description,
        language: selectedSnippet.language,
        code: selectedSnippet.code,
      });
      return;
    }

    const [firstSnippet] = sortedSnippets;
    if (firstSnippet) {
      setSelectedSnippetId(firstSnippet.id);
      return;
    }

    setIsCreatingNew(true);
    setDraft(EMPTY_SNIPPET_DRAFT);
  }, [isCreatingNew, selectedSnippet, sortedSnippets]);

  useEffect(() => {
    if (!pendingLinkedSnippetId) {
      return;
    }

    const matchingSnippet = sortedSnippets.find((snippet) => snippet.id === pendingLinkedSnippetId);
    if (matchingSnippet) {
      setSelectedSnippetId(matchingSnippet.id);
      setIsCreatingNew(false);
    }

    setPendingLinkedSnippetId(null);
  }, [pendingLinkedSnippetId, setPendingLinkedSnippetId, sortedSnippets]);

  const handleStartNewSnippet = () => {
    setIsCreatingNew(true);
    setSelectedSnippetId(null);
    setDraft(EMPTY_SNIPPET_DRAFT);
  };

  const handleSaveActiveTab = () => {
    if (!activeTab) {
      return;
    }

    setIsCreatingNew(true);
    setSelectedSnippetId(null);
    setDraft(createDraftFromActiveTab(activeTab, t));
  };

  const handleSaveSnippet = () => {
    const snippetPayload = {
      label: draft.label.trim(),
      description: draft.description.trim(),
      language: draft.language,
      code: draft.code,
    };

    if (!canSaveSnippet) {
      return;
    }

    if (isCreatingNew || !selectedSnippet) {
      const snippetId = addSnippet(snippetPayload);
      // `addSnippet` returns `null` when the Free-tier ceiling blocks the
      // save; the upsell notice is already surfaced by the store, so keep
      // the modal open on the user's draft instead of mutating selection.
      if (snippetId === null) {
        return;
      }
      setSelectedSnippetId(snippetId);
      setIsCreatingNew(false);
      return;
    }

    updateSnippet(selectedSnippet.id, snippetPayload);
  };

  const handleDeleteSnippet = () => {
    if (!selectedSnippet) {
      return;
    }

    // UX Sweep T2 fold B — snippet delete is recoverable, so it deletes
    // optimistically and offers an Undo toast rather than blocking on a
    // confirm. Stash the snippet AND its index in the persisted store
    // array so Undo re-inserts it verbatim at the same position.
    const storeSnippets = useSnippetsStore.getState().snippets;
    const removed = storeSnippets.find((s) => s.id === selectedSnippet.id);
    const removedIndex = storeSnippets.findIndex(
      (s) => s.id === selectedSnippet.id
    );
    const maxCountAfterRestore = storeSnippets.length;

    removeSnippet(selectedSnippet.id);
    const remainingSnippets = sortedSnippets.filter(
      (snippet) => snippet.id !== selectedSnippet.id
    );
    setSelectedSnippetId(remainingSnippets[0]?.id ?? null);
    setIsCreatingNew(remainingSnippets.length === 0);
    if (remainingSnippets.length === 0) {
      setDraft(EMPTY_SNIPPET_DRAFT);
    }

    if (removed) {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'snippets.notice.deleted',
        values: { label: removed.label || t('snippets.detail.fallbackHeading') },
        actions: [
          {
            labelKey: 'common.undo',
            onClick: () => {
              // Re-insert at the original index. `restoreSnippet` no-ops
              // if the snippet already exists (e.g. a re-create raced the
              // toast) or if the user filled the freed slot before Undo,
              // so a double-undo can never duplicate it or bypass the cap.
              useSnippetsStore
                .getState()
                .restoreSnippet(removed, removedIndex, maxCountAfterRestore);
              const restored = useSnippetsStore
                .getState()
                .snippets.some((snippet) => snippet.id === removed.id);
              if (restored) {
                setSelectedSnippetId(removed.id);
                setIsCreatingNew(false);
              }
            },
          },
        ],
      });
    }
  };

  const handleOpenInNewTab = () => {
    const sourceSnippet = selectedSnippet ?? (canSaveSnippet ? draft : null);
    if (!sourceSnippet) {
      return;
    }

    const fallbackFilename = t('snippets.draft.defaultFilename');
    const newTab = createDefaultTab(sourceSnippet.language);
    addTab({
      ...newTab,
      name: `${sourceSnippet.label.trim() || fallbackFilename}.${extensionForLanguage(sourceSnippet.language)}`,
      content: sourceSnippet.code,
    });
    onClose();
  };

  const handleInsertIntoActiveTab = () => {
    const sourceSnippet = selectedSnippet ?? (canSaveSnippet ? draft : null);
    if (!sourceSnippet || !activeTabId) {
      return;
    }

    const currentContent = activeTab?.content ?? '';
    const separator =
      currentContent.length === 0 || currentContent.endsWith('\n') ? '' : '\n\n';
    updateContent(activeTabId, `${currentContent}${separator}${sourceSnippet.code}`);
    onClose();
  };

  const detailHeading = isCreatingNew
    ? t('snippets.detail.newHeading')
    : selectedSnippet?.label ?? t('snippets.detail.fallbackHeading');

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-[900px]"
      labelledById="snippets-modal-title"
      headerClose="button"
      closeLabel={t('snippets.close')}
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt text-accent">
            <BookCopy size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="snippets-modal-title"
              className="truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
            >
              {t('snippets.header')}
            </h2>
            <p className="truncate text-body-sm text-fg-subtle">
              {t('snippets.detail.description')}
            </p>
          </div>
        </div>
      }
      bodyClassName="max-h-[min(72vh,560px)] overflow-y-auto p-4"
      footerLegend={
        <span className="text-body-sm text-fg-subtle">
          {activeTab
            ? t('snippets.activeTab.label', { name: activeTab.name })
            : t('snippets.activeTab.hint')}
        </span>
      }
      trailing={
        <div className="flex flex-wrap items-center gap-2">
          {!isCreatingNew && selectedSnippet ? (
            <button
              type="button"
              onClick={handleDeleteSnippet}
              className="button-danger"
            >
              <Trash2 size={13} />
              {t('snippets.actions.delete')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSaveSnippet}
            disabled={!canSaveSnippet}
            className="button-primary"
          >
            <Save size={13} />
            {isCreatingNew
              ? t('snippets.actions.saveNew')
              : t('snippets.actions.saveExisting')}
          </button>
        </div>
      }
    >
      <div
        data-tour-id="snippets-modal"
        className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]"
      >
        {/* MASTER — actions + snippet list */}
        <aside className="flex min-w-0 flex-col gap-3">
          <button
            type="button"
            onClick={handleStartNewSnippet}
            className="button-secondary w-full"
          >
            <Plus size={13} />
            {t('snippets.actions.new')}
          </button>
          <button
            type="button"
            onClick={handleSaveActiveTab}
            disabled={!activeTab}
            data-tour-id="snippets-save-active-tab"
            className="button-primary w-full"
          >
            <Save size={13} />
            {t('snippets.actions.saveActiveTab')}
          </button>

          <div className="flex flex-col gap-1">
            {sortedSnippets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-subtle bg-bg-inset px-4 py-6 text-center text-body-sm text-fg-subtle">
                {t('snippets.empty')}
              </div>
            ) : (
              sortedSnippets.map((snippet) => {
                const isActive =
                  !isCreatingNew && snippet.id === selectedSnippetId;
                return (
                  <button
                    key={snippet.id}
                    type="button"
                    // UX Sweep T5 — aria-current conveys the selection to
                    // assistive tech (it was color-only), and the active
                    // styling uses theme tokens instead of hardcoded light
                    // slate, which was invisible in the dark theme.
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => {
                      setSelectedSnippetId(snippet.id);
                      setIsCreatingNew(false);
                    }}
                    className={
                      isActive
                        ? 'focus-ring flex w-full flex-col rounded-lg border border-accent/40 bg-primary-soft px-3 py-[9px] text-left'
                        : 'focus-ring flex w-full flex-col rounded-lg border border-transparent px-3 py-[9px] text-left hover:bg-bg-inset'
                    }
                  >
                    <span className="truncate text-body font-medium text-fg-base">
                      {snippet.label}
                    </span>
                    <span className="truncate text-body-sm text-fg-subtle">
                      {snippet.description || languageLabel(snippet.language)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* DETAIL — heading + editor fields */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="panel-title">{t('snippets.detail.title')}</p>
              <h3 className="mt-1 truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base">
                {detailHeading}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenInNewTab}
                disabled={!canSaveSnippet && !selectedSnippet}
                className="button-secondary"
              >
                {t('snippets.actions.openInNewTab')}
              </button>
              <button
                type="button"
                onClick={handleInsertIntoActiveTab}
                disabled={!activeTabId || (!canSaveSnippet && !selectedSnippet)}
                className="button-primary"
              >
                {t('snippets.actions.insertIntoActiveTab')}
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="field-label">{t('snippets.fields.name.label')}</span>
              <input
                value={draft.label}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    label: event.target.value,
                  }))
                }
                placeholder={t('snippets.fields.name.placeholder')}
                className="field-shell"
              />
            </label>

            <label className="flex min-w-0 flex-col gap-2">
              <span className="field-label">{t('snippets.fields.language.label')}</span>
              <select
                value={draft.language}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    language: event.target.value as Language,
                  }))
                }
                className="field-shell"
                data-testid="snippets-language-select"
              >
                {SNIPPET_LANGUAGE_PACKS.map((pack) => {
                  // Append a localized "(desktop only)" suffix on the web
                  // build so users picking Go / Rust know runtime support
                  // is desktop-only — informational, the option stays
                  // selectable so a snippet can still be saved on web.
                  const isDesktopOnly =
                    languageCapabilityBadgeKey(pack.id) ===
                    'language.capability.desktopOnly';
                  const suffix =
                    isWebBuild && isDesktopOnly
                      ? t('language.capability.desktopOnlyOptionSuffix')
                      : '';
                  return (
                    <option key={pack.id} value={pack.id}>
                      {`${languageLabel(pack.id)}${suffix}`}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <label className="flex min-w-0 flex-col gap-2">
            <span className="field-label">
              {t('snippets.fields.description.label')}
            </span>
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft((currentValue) => ({
                  ...currentValue,
                  description: event.target.value,
                }))
              }
              placeholder={t('snippets.fields.description.placeholder')}
              className="field-shell"
            />
          </label>

          <label className="flex min-w-0 flex-col gap-2">
            <span className="field-label">{t('snippets.fields.code.label')}</span>
            <textarea
              value={draft.code}
              onChange={(event) =>
                setDraft((currentValue) => ({
                  ...currentValue,
                  code: event.target.value,
                }))
              }
              placeholder={t('snippets.fields.code.placeholder')}
              className="field-shell min-h-[220px] font-mono text-body leading-6"
              spellCheck={false}
            />
          </label>
        </section>
      </div>
    </ModalShell>
  );
}
