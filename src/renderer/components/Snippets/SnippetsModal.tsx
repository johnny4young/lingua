import { BookCopy, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import type { Language } from '../../types';
import {
  extensionForLanguage,
  languageCapabilityBadgeKey,
  languageLabel,
} from '../../utils/languageMeta';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';

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
  const { tabs, activeTabId, addTab, updateContent } = useEditorStore();
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
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
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

    removeSnippet(selectedSnippet.id);
    const remainingSnippets = sortedSnippets.filter(
      (snippet) => snippet.id !== selectedSnippet.id
    );
    setSelectedSnippetId(remainingSnippets[0]?.id ?? null);
    setIsCreatingNew(remainingSnippets.length === 0);
    if (remainingSnippets.length === 0) {
      setDraft(EMPTY_SNIPPET_DRAFT);
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
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        data-tour-id="snippets-modal"
        className="relative flex h-[min(82vh,760px)] w-full max-w-6xl flex-col overflow-hidden lg:flex-row"
      >
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="surface-header flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2">
              <BookCopy size={16} className="text-primary" />
              <div>
                <p className="panel-title">{t('snippets.panelTitle')}</p>
                <h2 className="text-sm font-semibold text-foreground">
                  {t('snippets.header')}
                </h2>
              </div>
            </div>
            <IconButton
              onClick={onClose}
              tooltip={t('snippets.close')}
              aria-label={t('snippets.close')}
            >
              <X size={16} />
            </IconButton>
          </div>

          <div className="grid gap-2 border-b border-border/80 px-4 py-4">
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
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sortedSnippets.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border/80 px-4 py-6 text-center text-xs text-muted">
                {t('snippets.empty')}
              </div>
            ) : (
              sortedSnippets.map((snippet) => (
                <button
                  key={snippet.id}
                  type="button"
                  onClick={() => {
                    setSelectedSnippetId(snippet.id);
                    setIsCreatingNew(false);
                  }}
                  className={`mb-1 flex w-full flex-col rounded-[1.2rem] px-3 py-3 text-left transition-colors ${
                    !isCreatingNew && snippet.id === selectedSnippetId
                      ? 'bg-primary-soft'
                      : 'hover:bg-surface-strong/72'
                  }`}
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {snippet.label}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {snippet.description || languageLabel(snippet.language)}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="surface-header flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="panel-title">{t('snippets.detail.title')}</p>
              <h3 className="mt-1 font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {detailHeading}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                {t('snippets.detail.description')}
              </p>
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

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
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

            <label className="flex min-h-0 flex-1 flex-col gap-2">
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
                className="field-shell min-h-[280px] flex-1 font-mono text-sm leading-6"
                spellCheck={false}
              />
            </label>
          </div>

          <div className="surface-header flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              {activeTab
                ? t('snippets.activeTab.label', { name: activeTab.name })
                : t('snippets.activeTab.hint')}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isCreatingNew && selectedSnippet && (
                <button
                  type="button"
                  onClick={handleDeleteSnippet}
                  className="button-danger"
                >
                  <Trash2 size={13} />
                  {t('snippets.actions.delete')}
                </button>
              )}
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
          </div>
        </section>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
