import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityTextarea,
  UtilityToolbar,
} from '../panelPrimitives';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { MARKDOWN_PREVIEW_MAX_KB, renderMarkdownPreview } from '../../../utils/markdownPreview';
import type { MarkdownPreviewResult } from '../../../utils/markdownPreview';

const DEFAULT_MARKDOWN_SAMPLE = `# Hello, Lingua

A **Markdown Preview** with [autolink](https://example.com) support.

- task list

  - [x] sanitized
  - [ ] no remote fetch

\`\`\`js
console.log("hello");
\`\`\`
`;

export function MarkdownPreviewPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(DEFAULT_MARKDOWN_SAMPLE);
  const [gfm, setGfm] = useState(true);
  const [result, setResult] = useState<MarkdownPreviewResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await renderMarkdownPreview(input, { gfm });
        if (!cancelled) setResult(next);
      } catch (error) {
        if (!cancelled) {
          setResult({
            ok: false,
            errorKey: 'utilities.tool.markdownPreview.error.loadFailure',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input, gfm]);

  const registerOutput = useCallback(() => (result && result.ok ? result.html : null), [result]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput(prev => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.markdownPreview.title')}
        description={t('utilities.tool.markdownPreview.panelDescription')}
      >
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            data-testid="markdown-preview-gfm"
            checked={gfm}
            onChange={event => setGfm(event.target.checked)}
          />
          <span>{t('utilities.tool.markdownPreview.gfm.label')}</span>
        </label>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.markdownPreview.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.markdownPreview.input.label')}
            data-testid="markdown-preview-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[18rem] font-mono"
          />
        </div>
        <UtilityToolbar
          utilityId="markdown-preview"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.markdownPreview.preview.label')}
        description={t('utilities.status.live')}
      >
        {result === null ? (
          <StatusMessage message={t('utilities.tool.markdownPreview.error.empty')} tone="muted" />
        ) : !result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: MARKDOWN_PREVIEW_MAX_KB })}
            tone={
              result.errorKey === 'utilities.tool.markdownPreview.error.empty' ? 'muted' : 'error'
            }
            testid="markdown-preview-error"
          />
        ) : (
          <div className="grid gap-2" data-testid="markdown-preview-rendered">
            {/*
             * The Markdown panel ships only the sanitized HTML output —
             * we deliberately do not render a visual preview because
             * neither inline `dangerouslySetInnerHTML` (security-hook
             * flagged) nor a sandboxed iframe (its own console-warning
             * footprint) is tradeoff-free in this code base. The user
             * can copy the HTML directly into any consumer that needs
             * to render it. Output is already DOMPurified and has had
             * remote `<img>` src attributes stripped.
             */}
            <FieldLabel>{t('utilities.tool.markdownPreview.html.label')}</FieldLabel>
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.markdownPreview.html.label')}
                data-testid="markdown-preview-html"
                value={result.html}
                readOnly
                spellCheck={false}
                className="pr-10 min-h-[20rem] font-mono"
              />
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.html}
                  testid="markdown-preview-html-copy"
                  disabled={!result.html}
                />
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}
