import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import i18next from 'i18next';
import { Btn, Eyebrow } from '../ui/primitives';

/**
 * RL-070 Sub-slice 7 — Signal-Slate error boundary.
 *
 * Two visual modes:
 *
 *   - `scope="panel"` — fills the parent container with a contained
 *     error notice; safe to mount around any sub-tree (a single
 *     panel, the console, the utilities pane). Other panels keep
 *     working.
 *
 *   - `scope="app"` — fills the viewport. Use only at the root of
 *     the app to catch render errors that escape every other
 *     boundary.
 *
 * The boundary preserves the error + stack in state so the user can
 * either reload (resets the boundary state, re-renders the children)
 * or — when the host environment supports it — file a bug with the
 * error pre-populated. We do NOT capture component stacks in
 * production logs to keep the boundary side-effect-free.
 *
 * The component is a class because React requires class components
 * for `componentDidCatch` / `getDerivedStateFromError`.
 */

export type ErrorBoundaryScope = 'panel' | 'app';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Visual mode — `panel` fills the parent, `app` fills the viewport.
   * Default `panel`.
   */
  scope?: ErrorBoundaryScope;
  /**
   * Optional named region (e.g. "Console", "Utilities") shown in the
   * error header so the user knows which sub-tree crashed.
   */
  regionName?: string;
  /**
   * Optional reload handler. When omitted, a built-in "Try again"
   * button just clears the boundary state. When provided, the host
   * can run a fuller reset (hard reload, navigate home, etc.) before
   * the boundary re-renders.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort console diagnostic. We intentionally avoid sending
    // anything to a remote logger because Lingua is local-first; the
    // user's code lives in this stack trace.
    console.error('[lingua] ErrorBoundary caught:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const scope = this.props.scope ?? 'panel';
    const isApp = scope === 'app';
    const region = this.props.regionName;

    return (
      <div
        role="alert"
        data-testid={`error-boundary-${scope}`}
        className={
          isApp
            ? 'fixed inset-0 z-[9000] flex items-center justify-center bg-background p-6'
            : 'flex h-full min-h-[160px] items-center justify-center p-6'
        }
      >
        <div
          className={
            isApp
              ? 'w-full max-w-lg rounded-[1.5rem] border border-error/40 bg-error/8 p-7 shadow-lg'
              : 'flex w-full max-w-md flex-col items-center text-center'
          }
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-[1rem] bg-error/15 text-error ${isApp ? '' : 'mb-3'}`}
            aria-hidden="true"
          >
            <AlertTriangle size={20} />
          </div>
          <Eyebrow className={isApp ? 'mt-4' : 'mt-1'}>
            {region
              ? i18next.t('errorBoundary.eyebrowWithRegion', {
                  region,
                })
              : i18next.t('errorBoundary.eyebrow')}
          </Eyebrow>
          <h2
            className={
              isApp
                ? 'font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-foreground'
                : 'font-display text-[18px] font-semibold tracking-[-0.015em] text-foreground'
            }
          >
            {isApp
              ? i18next.t('errorBoundary.app.title')
              : i18next.t('errorBoundary.panel.title')}
          </h2>
          <p
            className={`mt-2 max-w-md text-[12.5px] leading-[1.5] text-muted ${
              isApp ? '' : 'mx-auto'
            }`}
          >
            {isApp
              ? i18next.t('errorBoundary.app.body')
              : i18next.t('errorBoundary.panel.body')}
          </p>
          <pre
            className={`mt-4 max-h-32 overflow-auto rounded-[0.85rem] border border-error/30 bg-background-elevated/70 px-3 py-2 text-left font-mono text-[11px] leading-[1.45] text-error ${
              isApp ? '' : 'w-full'
            }`}
          >
            {this.state.error.message}
          </pre>
          <div className={`mt-4 flex flex-wrap items-center gap-2 ${isApp ? '' : 'justify-center'}`}>
            <Btn kind="primary" onClick={this.reset}>
              <RefreshCcw size={12} />{' '}
              {i18next.t('errorBoundary.tryAgain')}
            </Btn>
            {isApp ? (
              <Btn
                kind="secondary"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.reload();
                }}
              >
                {i18next.t('errorBoundary.reload')}
              </Btn>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
