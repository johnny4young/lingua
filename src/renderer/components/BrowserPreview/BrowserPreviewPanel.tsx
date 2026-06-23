import { Eye, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setActiveBrowserPreviewIframe } from '../../runtime/browserPreviewBridge';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useResultStore } from '../../stores/resultStore';
import { Tooltip } from '../ui/chrome';
import { cn } from '../../utils/cn';
import { isJavaScriptFamily } from '../../../shared/languageFamilies';

/**
 * RL-019 Slice 3 — bottom-panel surface for the Browser preview
 * runtime. Renders a sandboxed iframe + a thin status footer.
 *
 *   - On mount, registers the iframe element with the
 *     `browserPreviewBridge` so the runner can write into its
 *     `srcdoc`. On unmount, clears the registration so a stale ref
 *     never points at a torn-down element.
 *   - The footer reflects running / idle / error / timeout states
 *     by consuming the existing result store (`isManualRunning`,
 *     `error`).
 *   - Fold F — inspect button opens the current iframe document in
 *     a new opaque-origin data URL. Implemented as a best-effort
 *     affordance — wrapped in try/catch so the panel never breaks
 *     if the host blocks popups.
 */
export function BrowserPreviewPanel() {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isManualRunning = useResultStore((state) => state.isManualRunning);
  const error = useResultStore((state) => state.error);
  const activeTab = useActiveTab();
  // Status text key — running / error / idle.
  const statusKey = isManualRunning
    ? 'browserPreview.running'
    : error
      ? 'browserPreview.runtimeError'
      : 'browserPreview.empty';
  const isJsTsTab = isJavaScriptFamily(activeTab?.language);
  const isBrowserPreviewMode = activeTab?.runtimeMode === 'browser-preview';

  // Registration lifecycle. Strict-Mode-safe: snapshot the ref at
  // effect-fire time so the cleanup uses the same element it saw
  // on mount (lint flags reading `.current` inside cleanup because
  // it can move between fire and cleanup; the snapshot is the
  // canonical workaround).
  useEffect(() => {
    const element = iframeRef.current;
    setActiveBrowserPreviewIframe(element);
    return () => {
      setActiveBrowserPreviewIframe(null);
      // Reference `element` so the lint rule treats it as
      // captured. The ref itself moves on remount; the cleanup
      // intentionally clears the bridge regardless.
      void element;
    };
  }, []);

  const [inspectFailed, setInspectFailed] = useState(false);
  const handleInspect = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.srcdoc) {
        setInspectFailed(true);
        return;
      }
      // Open as a top-level data URL rather than a Blob URL.
      // Blob URLs inherit the app origin in Chromium, which would
      // give user preview code access to Lingua's localStorage in
      // the new window. A data URL gets an opaque origin and keeps
      // the inspect surface aligned with the sandboxed iframe.
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(iframe.srcdoc)}`;
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        setInspectFailed(true);
      } else {
        setInspectFailed(false);
      }
    } catch {
      setInspectFailed(true);
    }
  }, []);

  return (
    <div className="flex h-full flex-col bg-background/65" data-testid="browser-preview-panel">
      <div className="surface-header flex h-12 shrink-0 items-center justify-between px-4">
        <div>
          <span className="panel-title">{t('browserPreview.title')}</span>
          <p className="mt-0.5 text-caption text-muted">{t('browserPreview.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isManualRunning ? <Loader2 size={13} className="animate-spin text-primary" /> : null}
          <Tooltip content={t('browserPreview.inspect.tooltip')} side="left">
            <button
              type="button"
              onClick={handleInspect}
              data-testid="browser-preview-inspect-button"
              aria-label={t('browserPreview.inspect.tooltip')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface-strong/72 px-2.5 py-1 text-caption font-semibold text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ExternalLink size={11} />
              {t('browserPreview.inspect.label')}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          // Strict sandbox: scripts run, but no same-origin, no
          // popups, no top-navigation. The iframe sees its origin
          // as `null` so cookies / localStorage / our app origin
          // are unreachable from user code.
          sandbox="allow-scripts"
          title={t('browserPreview.iframeTitle')}
          data-testid="browser-preview-iframe"
          className={cn(
            'h-full w-full bg-white',
            // Hint to the user when no run has happened yet.
            !isJsTsTab || !isBrowserPreviewMode ? 'opacity-70' : ''
          )}
          // Leave srcdoc empty until the runner assigns one. An
          // initial srcdoc would render about:srcdoc inside the
          // sandboxed iframe, which Chromium reports as a
          // SecurityError when scripts probe serviceWorker /
          // storage. The runner writes the full document before
          // user code runs.
        />
        {!isJsTsTab || !isBrowserPreviewMode ? (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/72 px-6 text-center text-body-sm text-muted"
            data-testid="browser-preview-empty-overlay"
          >
            <Eye size={20} aria-hidden="true" />
            <p>{t('browserPreview.empty')}</p>
          </div>
        ) : null}
      </div>
      <div className="surface-header flex h-9 shrink-0 items-center justify-between border-t border-border/60 px-4 text-caption text-muted">
        <span data-testid="browser-preview-status">{t(statusKey)}</span>
        {inspectFailed ? (
          <span className="text-error" data-testid="browser-preview-inspect-error">
            {t('browserPreview.inspect.blocked')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
