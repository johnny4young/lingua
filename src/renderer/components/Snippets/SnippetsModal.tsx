import { BookCopy, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import type { Language } from '../../types';
import { extensionForLanguage, languageLabel } from '../../utils/languageMeta';
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

const BUILT_IN_LANGUAGES: Language[] = [
  'javascript',
  'typescript',
  'go',
  'python',
  'rust',
];

function trimTabName(tabName: string): string {
  const trimmedName = tabName.replace(/\.[^.]+$/, '').trim();
  return trimmedName.length > 0 ? trimmedName : 'Snippet';
}

function createDraftFromActiveTab(
  activeTab: { name: string; language: Language; content: string } | undefined
): SnippetDraft {
  if (!activeTab) {
    return EMPTY_SNIPPET_DRAFT;
  }

  return {
    label: trimTabName(activeTab.name),
    description: `Saved from ${activeTab.name}`,
    language: activeTab.language,
    code: activeTab.content,
  };
}

export function SnippetsModal({ onClose }: SnippetsModalProps) {
  const { snippets, addSnippet, removeSnippet, updateSnippet } = useSnippetsStore();
  const { tabs, activeTabId, addTab, updateContent } = useEditorStore();
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
    setDraft(createDraftFromActiveTab(activeTab));
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

    const newTab = createDefaultTab(sourceSnippet.language);
    addTab({
      ...newTab,
      name: `${sourceSnippet.label.trim() || 'snippet'}.${extensionForLanguage(sourceSnippet.language)}`,
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

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard className="relative flex h-[min(82vh,760px)] w-full max-w-6xl flex-col overflow-hidden lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="surface-header flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2">
              <BookCopy size={16} className="text-primary" />
              <div>
                <p className="panel-title">Snippet Library</p>
                <h2 className="text-sm font-semibold text-foreground">Snippets</h2>
              </div>
            </div>
            <IconButton onClick={onClose} title="Close snippets">
              <X size={16} />
            </IconButton>
          </div>

          <div className="grid gap-2 border-b border-border/80 px-4 py-4">
            <button onClick={handleStartNewSnippet} className="button-secondary w-full">
              <Plus size={13} />
              New
            </button>
            <button
              onClick={handleSaveActiveTab}
              disabled={!activeTab}
              className="button-primary w-full"
            >
              <Save size={13} />
              Save Active Tab
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sortedSnippets.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border/80 px-4 py-6 text-center text-xs text-muted">
                No snippets saved yet.
              </div>
            ) : (
              sortedSnippets.map((snippet) => (
                <button
                  key={snippet.id}
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
              <p className="panel-title">Workspace Snippet</p>
              <h3 className="mt-1 font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {isCreatingNew ? 'New snippet' : selectedSnippet?.label ?? 'Snippet'}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Save reusable code, edit it, then reopen it later from the command palette or this
                library.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleOpenInNewTab}
                disabled={!canSaveSnippet && !selectedSnippet}
                className="button-secondary"
              >
                Open in New Tab
              </button>
              <button
                onClick={handleInsertIntoActiveTab}
                disabled={!activeTabId || (!canSaveSnippet && !selectedSnippet)}
                className="button-primary"
              >
                Insert into Active Tab
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="field-label">Name</span>
                <input
                  value={draft.label}
                  onChange={(event) =>
                    setDraft((currentValue) => ({
                      ...currentValue,
                      label: event.target.value,
                    }))
                  }
                  placeholder="Snippet name"
                  className="field-shell"
                />
              </label>

              <label className="flex min-w-0 flex-col gap-2">
                <span className="field-label">Language</span>
                <select
                  value={draft.language}
                  onChange={(event) =>
                    setDraft((currentValue) => ({
                      ...currentValue,
                      language: event.target.value as Language,
                    }))
                  }
                  className="field-shell"
                >
                  {BUILT_IN_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {languageLabel(language)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex min-w-0 flex-col gap-2">
              <span className="field-label">Description</span>
              <input
                value={draft.description}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    description: event.target.value,
                  }))
                }
                placeholder="Short note about when to use this snippet"
                className="field-shell"
              />
            </label>

            <label className="flex min-h-0 flex-1 flex-col gap-2">
              <span className="field-label">Code</span>
              <textarea
                value={draft.code}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    code: event.target.value,
                  }))
                }
                placeholder="Paste or write the snippet code"
                className="field-shell min-h-[280px] flex-1 font-mono text-sm leading-6"
                spellCheck={false}
              />
            </label>
          </div>

          <div className="surface-header flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              {activeTab
                ? `Active tab: ${activeTab.name}`
                : 'Open a tab to enable “Save Active Tab” and “Insert into Active Tab”.'}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isCreatingNew && selectedSnippet && (
                <button onClick={handleDeleteSnippet} className="button-danger">
                  <Trash2 size={13} />
                  Delete
                </button>
              )}
              <button
                onClick={handleSaveSnippet}
                disabled={!canSaveSnippet}
                className="button-primary"
              >
                <Save size={13} />
                {isCreatingNew ? 'Save Snippet' : 'Save Changes'}
              </button>
            </div>
          </div>
        </section>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
