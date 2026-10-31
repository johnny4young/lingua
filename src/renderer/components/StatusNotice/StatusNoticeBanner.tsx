import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useUIStore,
  type StatusNoticeAction,
  type StatusNoticeTone,
} from '../../stores/uiStore';
import { isStickyNotice } from '../../stores/statusNoticeQueue';
import { cn } from '../../utils/cn';

const AUTO_DISMISS_MS = 8000;

/**
 * The visible status notice, docked in its own row above the status bar so it
 * never covers the editor, the dock or a dialog's content. Sticky notices stay
 * until acted on; the rest leave after AUTO_DISMISS_MS, paused while hovered or
 * focused. The next queued notice takes its place.
 */
export function StatusNoticeBanner() {
  const { t } = useTranslation();
  const notice = useUIStore((state) => state.statusNotice);
  const dismissStatusNotice = useUIStore((state) => state.dismissStatusNotice);

  // Track whether the visible notice ever fires a
  // CTA so the auto-dismiss timeout doesn't mis-attribute a
  // user-triggered close as `'auto'`.
  const ctaFiredRef = useRef(false);
  // Keyed by notice id so a replacement notice never inherits a stale pause.
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const paused = notice !== null && (hoveredId === notice.id || focusedId === notice.id);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasNotice = notice !== null;

  // Dialogs end where the row starts, so a notice never covers one.
  useEffect(() => {
    const root = document.documentElement;
    const row = rowRef.current;
    if (!hasNotice || !row) return;
    const publish = () => root.style.setProperty('--notice-row-offset', `${Math.max(0, window.innerHeight - row.getBoundingClientRect().top)}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(row);
    window.addEventListener('resize', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty('--notice-row-offset');
    };
  }, [hasNotice]);
  useEffect(() => {
    ctaFiredRef.current = false;
  }, [notice?.id]);

  useEffect(() => {
    if (!notice) return;
    if (isStickyNotice(notice)) return undefined;
    if (paused) return undefined;
    const timeout = window.setTimeout(() => {
      // If the user clicked a CTA the dismiss already fired as
      // `'cta'`; this auto-timeout would otherwise also fire and
      // double-report. Skip when we know a CTA already ran.
      if (ctaFiredRef.current) return;
      dismissStatusNotice('auto');
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [notice, dismissStatusNotice, paused]);

  if (!notice) return null;

  const actions: ReadonlyArray<StatusNoticeAction> = notice.actions ?? [];

  const handleActionClick = (action: StatusNoticeAction) => {
    ctaFiredRef.current = true;
    // Dismiss the original notice before invoking the CTA so the
    // action is free to push the next notice without having that
    // replacement cleared by this handler's final cleanup. If the
    // action throws, the notice is already gone but the user has
    // visible feedback through whatever surface the action surfaces
    // (e.g. snippets store pushes its own upsell on Free-tier
    // budget overrun). The catch keeps a render-time exception from
    // breaking the banner cleanup; the error itself surfaces via
    // the error boundary higher up.
    dismissStatusNotice('cta');
    try {
      action.onClick();
    } catch (cause) {
      // Re-throw asynchronously so React's error boundary picks it
      // up without disrupting the in-flight click handler return.
      setTimeout(() => {
        throw cause;
      }, 0);
    }
  };

  return (
    <div
      ref={rowRef}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
      data-testid="status-notice-banner"
      data-tone={notice.tone}
      onMouseEnter={() => setHoveredId(notice.id)}
      onMouseLeave={() => setHoveredId(null)}
      onFocus={() => setFocusedId(notice.id)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null);
      }}
      className={cn(
        'pointer-events-auto relative z-[60] flex shrink-0 items-start gap-3 border-t px-4 py-2',
        toneClasses(notice.tone)
      )}
    >
      <ToneIcon tone={notice.tone} />
      <div className="grid min-w-0 flex-1 gap-0.5 text-body">
        <p className="font-medium leading-5">{t(notice.messageKey, notice.values)}</p>
        {notice.detail ? (
          <p className="max-h-12 overflow-auto text-caption leading-[1.45] text-muted">
            {notice.detail}
          </p>
        ) : null}
      </div>
      {actions.length > 0 ? (
          <div
            className="flex shrink-0 flex-wrap items-center gap-2"
            data-testid="status-notice-actions"
          >
            {actions.map((action) => (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => handleActionClick(action)}
                data-testid={`status-notice-action-${action.labelKey}`}
                className="rounded-full border border-foreground/20 bg-surface-strong/80 px-3 py-1 text-body-sm font-medium text-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
              >
                {t(action.labelKey, action.labelValues)}
              </button>
            ))}
          </div>
        ) : null}
      <button
        type="button"
        onClick={() => dismissStatusNotice('manual')}
        aria-label={t('statusNotice.dismiss')}
        className="-mr-1 shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function toneClasses(tone: StatusNoticeTone): string {
  switch (tone) {
    case 'success':
      return 'border-success/45 bg-success-bg text-foreground';
    case 'warning':
      return 'border-warning/45 bg-warning-bg text-foreground';
    case 'error':
      return 'border-error/45 bg-error-bg text-foreground';
    case 'info':
    default:
      return 'border-info/45 bg-info-bg text-foreground';
  }
}

function ToneIcon({ tone }: { tone: StatusNoticeTone }) {
  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'error'
          ? XCircle
          : Info;
  const colorClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'error'
          ? 'text-error'
          : 'text-info';
  return (
    <Icon
      size={16}
      className={cn('mt-0.5 shrink-0', colorClass)}
      aria-hidden="true"
    />
  );
}
