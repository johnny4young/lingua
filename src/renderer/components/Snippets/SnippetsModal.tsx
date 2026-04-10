import { BookCopy, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import type { Language } from '../../types';
import { extensionForLanguage, languageLabel } from '../../utils/languageMeta';

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
  const canSaveSnippet =
    draft.label.trim().length > 0 && draft.code.trim().length > 0;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative flex h-[min(78vh,720px)] w-full max-w-6xl overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex w-72 shrink-0 flex-col border-r border-gray-800 bg-gray-950/70">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <BookCopy size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold text-gray-100">Snippets</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
              title="Close snippets"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex gap-2 border-b border-gray-800 px-4 py-3">
            <button
              onClick={handleStartNewSnippet}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
            >
              <Plus size={13} />
              New
            </button>
            <button
              onClick={handleSaveActiveTab}
              disabled={!activeTab}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-300 transition-colors hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={13} />
              Save Active Tab
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sortedSnippets.length === 0 ? (
              <div className="rounded border border-dashed border-gray-800 px-3 py-4 text-center text-xs text-gray-500">
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
                  className={`mb-1 flex w-full flex-col rounded px-3 py-2 text-left transition-colors ${
                    !isCreatingNew && snippet.id === selectedSnippetId
                      ? 'bg-primary-500/15'
                      : 'hover:bg-gray-800/70'
                  }`}
                >
                  <span className="truncate text-sm text-gray-200">{snippet.label}</span>
                  <span className="truncate text-xs text-gray-500">
                    {snippet.description || languageLabel(snippet.language)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">
                {isCreatingNew ? 'New snippet' : selectedSnippet?.label ?? 'Snippet'}
              </h3>
              <p className="text-xs text-gray-500">
                Save reusable code, edit it, then reopen it later from the command palette or this library.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenInNewTab}
                disabled={!canSaveSnippet && !selectedSnippet}
                className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Open in New Tab
              </button>
              <button
                onClick={handleInsertIntoActiveTab}
                disabled={!activeTabId || (!canSaveSnippet && !selectedSnippet)}
                className="rounded bg-primary-500/15 px-3 py-1.5 text-xs font-medium text-primary-300 transition-colors hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Insert into Active Tab
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-gray-400">Name</span>
                <input
                  value={draft.label}
                  onChange={(event) =>
                    setDraft((currentValue) => ({
                      ...currentValue,
                      label: event.target.value,
                    }))
                  }
                  placeholder="Snippet name"
                  className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-primary-500/60"
                />
              </label>

              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-gray-400">Language</span>
                <select
                  value={draft.language}
                  onChange={(event) =>
                    setDraft((currentValue) => ({
                      ...currentValue,
                      language: event.target.value as Language,
                    }))
                  }
                  className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-primary-500/60"
                >
                  {BUILT_IN_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {languageLabel(language)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-400">Description</span>
              <input
                value={draft.description}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    description: event.target.value,
                  }))
                }
                placeholder="Short note about when to use this snippet"
                className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-primary-500/60"
              />
            </label>

            <label className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-400">Code</span>
              <textarea
                value={draft.code}
                onChange={(event) =>
                  setDraft((currentValue) => ({
                    ...currentValue,
                    code: event.target.value,
                  }))
                }
                placeholder="Paste or write the snippet code"
                className="min-h-[280px] flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm leading-6 text-gray-100 outline-none transition-colors focus:border-primary-500/60"
                spellCheck={false}
              />
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-gray-800 px-5 py-3">
            <div className="text-xs text-gray-500">
              {activeTab
                ? `Active tab: ${activeTab.name}`
                : 'Open a tab to enable “Save Active Tab” and “Insert into Active Tab”.'}
            </div>

            <div className="flex items-center gap-2">
              {!isCreatingNew && selectedSnippet && (
                <button
                  onClick={handleDeleteSnippet}
                  className="flex items-center gap-1.5 rounded bg-error-500/10 px-3 py-1.5 text-xs font-medium text-error-500 transition-colors hover:bg-error-500/20"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              )}
              <button
                onClick={handleSaveSnippet}
                disabled={!canSaveSnippet}
                className="flex items-center gap-1.5 rounded bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={13} />
                {isCreatingNew ? 'Save Snippet' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
