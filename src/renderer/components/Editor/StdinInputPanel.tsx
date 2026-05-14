/**
 * RL-020 Slice 6 — bottom-panel "Input" tab body.
 *
 * Reads / writes the active tab's `stdinBuffer` via the editorStore
 * action. Self-gates on language (JS / TS / Python today); other
 * languages get a localized empty-state hint so opening the panel
 * never silently no-ops.
 *
 * Fold G — the "Used N of M lines" surface reads
 * `useResultStore.stdinConsumed` (populated by the runner after the
 * worker reports its consumption summary).
 */

import { MessageSquare, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import type { Language } from '../../types';

const SUPPORTED: ReadonlySet<Language> = new Set<Language>([
  'javascript',
  'typescript',
  'python',
]);

/**
 * RL-020 Slice 6 UX refinement — show the buffer as numbered prompt
 * slots so the user can SEE the 1-to-1 mapping between lines and
 * `prompt()` / `input()` calls. Returns the line count and the line
 * preview text (trimmed for the gutter). A trailing empty line is
 * dropped so `"a\nb\n"` renders the same as `"a\nb"`.
 */
function bufferLines(buffer: string): string[] {
  if (!buffer) return [];
  const lines = buffer.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function StdinInputPanel() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const setTabStdinBuffer = useEditorStore((state) => state.setTabStdinBuffer);
  const stdinConsumed = useResultStore((state) => state.stdinConsumed);

  if (!activeTab) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        data-testid="stdin-panel-empty"
      >
        <span className="text-xs italic text-muted">
          {t('stdin.panel.empty')}
        </span>
      </div>
    );
  }

  if (!SUPPORTED.has(activeTab.language)) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        data-testid="stdin-panel-unsupported"
      >
        <span className="text-xs italic text-muted">
          {t('stdin.panel.unsupportedLanguage')}
        </span>
      </div>
    );
  }

  const buffer = activeTab.stdinBuffer ?? '';
  const lines = bufferLines(buffer);
  const lineCount = lines.length;
  const promptFn = activeTab.language === 'python' ? 'input()' : 'prompt()';

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTabStdinBuffer(activeTab.id, event.target.value);
  };

  const handleClear = () => {
    setTabStdinBuffer(activeTab.id, null);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 p-3"
      data-testid="stdin-panel"
      data-stdin-language={activeTab.language}
    >
      <header className="flex flex-shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={11} aria-hidden="true" className="opacity-60" />
            <span className="panel-title">{t('stdin.panel.title')}</span>
            <span className="status-pill tabular-nums text-[10px] uppercase tracking-[0.08em]">
              {t('stdin.panel.lineCountBadge', {
                count: lineCount,
                promptFn,
              })}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {t('stdin.panel.descriptionShort', { promptFn })}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {stdinConsumed && stdinConsumed.total > 0 && (
            <span
              data-testid="stdin-panel-consumed"
              className="status-pill tabular-nums text-[10px]"
            >
              {t('stdin.panel.consumed', {
                count: stdinConsumed.count,
                total: stdinConsumed.total,
              })}
            </span>
          )}
          {lineCount > 0 && (
            <button
              type="button"
              onClick={handleClear}
              data-testid="stdin-panel-clear"
              aria-label={t('stdin.panel.clear')}
              title={t('stdin.panel.clear')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/40 bg-transparent text-muted transition-colors hover:border-error/40 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <div className="relative flex flex-1 min-h-0 overflow-hidden rounded-[0.7rem] border border-border/50 bg-background/55 focus-within:border-primary/70">
        <div
          aria-hidden="true"
          className="pointer-events-none select-none border-r border-border/30 bg-surface-strong/40 px-2 py-2 text-right font-mono text-[10px] leading-5 text-muted"
        >
          {Array.from({ length: Math.max(lineCount + 1, 6) }, (_, index) => (
            <div key={index} className="tabular-nums">
              {index + 1}.
            </div>
          ))}
        </div>
        <textarea
          value={buffer}
          onChange={handleChange}
          spellCheck={false}
          placeholder={t('stdin.panel.placeholder')}
          aria-label={t('stdin.panel.ariaLabel')}
          data-testid="stdin-panel-textarea"
          className="flex-1 resize-none bg-transparent p-2 font-mono text-xs leading-5 text-foreground placeholder:text-muted focus:outline-none"
        />
      </div>
      <p className="text-[10px] italic text-muted">
        {t('stdin.panel.footerHint', { promptFn })}
      </p>
    </div>
  );
}
