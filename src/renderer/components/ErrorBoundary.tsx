/**
 * RL-090 — top-level React error boundary for major shell regions.
 *
 * React error boundaries must be class components — hooks cannot
 * implement `componentDidCatch`. The boundary captures render-time
 * errors in its subtree, marks the next boot for safe mode (so a
 * subsequent reload always recovers), and renders a fallback UI
 * with three actions:
 *
 *   1. Copy redacted error report to the clipboard.
 *   2. Reload in safe mode (`?safe-mode=1`).
 *   3. Reset to defaults — only when the boundary's `onReset` prop
 *      is provided, otherwise hidden.
 *
 * Async errors and event-handler errors are NOT caught by React
 * boundaries; the global `window.onerror` /
 * `window.onunhandledrejection` listeners in `main.tsx` cover those
 * paths and feed the same crash counter.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';
import {
  buildErrorReport,
  copyErrorReportToClipboard,
  type RedactedErrorReport,
} from '../utils/redactedErrorReport';
import {
  buildCrashFingerprint,
  markCrashOnNextBoot,
  recordCrash,
} from '../utils/safeBoot';

interface ErrorBoundaryProps extends WithTranslation {
  /**
   * Stable identifier for the region this boundary protects (e.g.
   * `editor`, `sidebar`). Used as an i18n suffix and in the
   * redacted error report.
   */
  region: string;
  /**
   * When provided, the fallback renders a "Reset to defaults" button
   * that calls this callback. Omit when no domain-specific reset
   * makes sense for the region.
   */
  onReset?: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  report: RedactedErrorReport | null;
  copyState: 'idle' | 'success' | 'failed';
}

class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    report: null,
    copyState: 'idle',
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const report = buildErrorReport(error, this.props.region);
    this.setState({ report });
    // Mark the next boot for safe mode AND record the crash in the
    // boot-loop counter so three crashes within 60s escalate to
    // factory mode automatically. The fingerprint dedupes against
    // the global window.error listener — under React StrictMode a
    // single render-time throw can fire BOTH paths, which would
    // otherwise double-count toward the boot-loop threshold.
    try {
      markCrashOnNextBoot();
      recordCrash(Date.now(), buildCrashFingerprint(error));
    } catch {
      // Best-effort — quota / SecurityError on private mode is non-fatal.
    }
  }

  private handleCopyReport = async (): Promise<void> => {
    const { report } = this.state;
    if (!report) return;
    const ok = await copyErrorReportToClipboard(report);
    this.setState({ copyState: ok ? 'success' : 'failed' });
  };

  private handleReloadSafe = (): void => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('safe-mode', '1');
      window.location.href = url.toString();
    } catch {
      window.location.search = '?safe-mode=1';
    }
  };

  private handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null, report: null, copyState: 'idle' });
  };

  render(): ReactNode {
    const { error, report, copyState } = this.state;
    const { t, region, onReset } = this.props;

    if (!error) return this.props.children;

    const fallbackTitle = t('errorBoundary.title', { region: t(`errorBoundary.region.${region}`, region) });

    return (
      <div
        role="alert"
        data-testid={`error-boundary-${region}`}
        data-region={region}
        className="flex h-full w-full flex-col gap-3 rounded-2xl border border-border/80 bg-background-elevated/72 p-5"
      >
        <h2 className="font-display text-h3 font-semibold tracking-[-0.02em] text-foreground">
          {fallbackTitle}
        </h2>
        <p className="text-body leading-6 text-muted">{t('errorBoundary.description')}</p>
        {report ? (
          <p className="font-mono text-body-sm leading-5 text-muted">
            {report.errorName}: {report.errorMessage}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void this.handleCopyReport()}
            className="button-secondary"
            data-testid={`error-boundary-${region}-copy`}
          >
            <span>
              {copyState === 'success'
                ? t('errorBoundary.copy.success')
                : copyState === 'failed'
                  ? t('errorBoundary.copy.failed')
                  : t('errorBoundary.copy.button')}
            </span>
          </button>
          <button
            type="button"
            onClick={this.handleReloadSafe}
            className="button-secondary"
            data-testid={`error-boundary-${region}-reload`}
          >
            <span>{t('errorBoundary.reloadSafe.button')}</span>
          </button>
          {onReset ? (
            <button
              type="button"
              onClick={this.handleReset}
              className="button-secondary"
              data-testid={`error-boundary-${region}-reset`}
            >
              <span>{t('errorBoundary.reset.button')}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryClass);
