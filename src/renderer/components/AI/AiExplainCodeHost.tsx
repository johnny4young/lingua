import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import { useAiExplainCodeStore } from '../../stores/aiExplainCodeStore';
import type { ExplainCodeDialogProps } from './ExplainCodeDialog';
import { loadAiExplainCodeDialog } from './aiExplainCodeDialogLoader';

type ExplainCodeDialogComponent = ComponentType<ExplainCodeDialogProps>;

function AiExplainCodeLoadingDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.explainCode.title')}
      aria-busy="true"
      data-testid="ai-explain-code-loading-dialog"
    >
      <div className="w-full max-w-[640px] overflow-hidden rounded-lg border border-border bg-bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t('ai.explainCode.title')}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ai.explain.close')}
            className="focus-ring rounded p-1 text-lg leading-none text-fg-subtle hover:text-fg"
          >
            ×
          </button>
        </div>
        <div
          className="flex items-center gap-3 px-4 py-5 text-sm text-fg-muted"
          role="status"
          aria-live="polite"
        >
          <span
            className="size-4 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden="true"
          />
          {t('ai.explainCode.loadingDialog')}
        </div>
      </div>
    </div>
  );
}

/**
 * internal  — single mount point for the "Explain this code" dialog.
 * Renders it whenever the store holds an open request, so both the editor
 * context-menu action and the command-palette command open the same
 * dialog. Mounted once near the app root, while the complete dialog,
 * request builder, answer renderer, and transport load only after a request.
 */
export function AiExplainCodeHost() {
  const request = useAiExplainCodeStore(s => s.request);
  const close = useAiExplainCodeStore(s => s.close);
  const { error: pushErrorNotice } = useStatusNotice();
  const [Dialog, setDialog] = useState<ExplainCodeDialogComponent | null>(null);
  const loadPendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!request || Dialog || loadPendingRef.current) return;

    loadPendingRef.current = true;
    void loadAiExplainCodeDialog()
      .then(module => {
        if (!mountedRef.current) return;
        setDialog(() => module.ExplainCodeDialog);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || !useAiExplainCodeStore.getState().request) return;
        console.error('[ai] failed to load the explain-code dialog', error);
        pushErrorNotice('ai.explainCode.loadFailed');
        useAiExplainCodeStore.getState().close();
      })
      .finally(() => {
        loadPendingRef.current = false;
      });
  }, [Dialog, pushErrorNotice, request]);

  if (!request) return null;
  if (!Dialog) return <AiExplainCodeLoadingDialog onClose={close} />;

  return (
    <Dialog
      code={request.code}
      language={request.language}
      filename={request.filename}
      onClose={close}
    />
  );
}
