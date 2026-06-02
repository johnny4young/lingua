import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useDocumentSymbols } from '../../hooks/useDocumentSymbols';
import { filterSymbols, type SymbolEntry } from '../../utils/symbolNavigation';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';

interface GoToSymbolProps {
  onClose: () => void;
}

function symbolKindBadge(kind: string): string {
  // Map common TS navigation-bar kinds to a stable short label so the list
  // row shows something compact even for long TS enum names.
  switch (kind) {
    case 'class':
      return 'class';
    case 'interface':
      return 'iface';
    case 'method':
    case 'member':
      return 'fn';
    case 'function':
      return 'fn';
    case 'enum':
      return 'enum';
    case 'var':
    case 'const':
    case 'let':
      return 'var';
    case 'property':
      return 'prop';
    default:
      return kind || '—';
  }
}

export function GoToSymbol({ onClose }: GoToSymbolProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const requestReveal = useEditorStore((state) => state.requestReveal);

  const activeTab = useActiveTab();

  // Symbols are only loaded while the overlay is mounted — the hook's
  // `enabled` flag skips the TS-worker round-trip when this component is
  // torn down.
  const { status, entries } = useDocumentSymbols(activeTab, true);

  // Keep matching logic in the pure utility so the overlay only owns focus,
  // keyboard selection, and reveal orchestration.
  const filtered = useMemo(() => filterSymbols(entries, query), [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activeSelectedIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  // Keep the selected row visible in the scroller.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = Array.from(list.children)[activeSelectedIndex] as
      | HTMLElement
      | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeSelectedIndex]);

  const selectSymbol = (entry: SymbolEntry) => {
    if (!activeTab) return;
    // Same-tab reveal: the active tab already owns the Monaco model so we
    // target it via `tabId` rather than `filePath`. That keeps Go to Symbol
    // working on unsaved tabs too.
    requestReveal({
      tabId: activeTab.id,
      line: entry.line,
      column: entry.column,
    });
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length === 0) return;
      // Navigation is bounded rather than circular; repeated arrows stop at
      // the first/last symbol just like QuickOpen and ProjectSearch.
      setSelectedIndex((current) => Math.min(current + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[activeSelectedIndex];
      if (target) selectSymbol(target);
      return;
    }
    handleCloseOnEscape(event, onClose);
  };

  // Status copy is ordered from structural blockers to query-level misses so
  // unsupported tabs do not show a misleading "no symbols" empty state.
  const emptyCopy = (() => {
    if (!activeTab) return t('goToSymbol.empty.noTab');
    if (status === 'unsupported') return t('goToSymbol.empty.unsupported');
    if (status === 'loading') return t('goToSymbol.loading');
    if (filtered.length === 0 && query.trim().length > 0) {
      return t('goToSymbol.empty.noMatch', { query });
    }
    return t('goToSymbol.empty.noSymbols');
  })();

  const showList = filtered.length > 0;

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.item.goToSymbol.label')}
        className="w-full max-w-2xl"
      >
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('goToSymbol.placeholder')}
            aria-label={t('goToSymbol.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[22rem] overflow-y-auto px-2 py-2">
          {showList ? (
            filtered.map((entry, index) => {
              const isSelected = index === activeSelectedIndex;
              const key = `${entry.qualifiedName}:${entry.line}:${entry.column}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectSymbol(entry)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-primary-soft' : 'hover:bg-surface-strong/68'
                  }`}
                >
                  <span className="status-pill shrink-0">{symbolKindBadge(entry.kind)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {entry.name}
                    </span>
                    {entry.qualifiedName !== entry.name && (
                      <span className="truncate text-xs text-muted">
                        {entry.qualifiedName}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {entry.line}:{entry.column}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">{emptyCopy}</p>
          )}
        </div>

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> {t('goToSymbol.hint.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('goToSymbol.hint.open')}
          </span>
          <span className="ml-auto">
            {t('goToSymbol.count', { count: filtered.length })}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
