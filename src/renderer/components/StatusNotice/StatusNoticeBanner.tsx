import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useUIStore,
  type StatusNoticeAction,
  type StatusNoticeTone,
} from '../../stores/uiStore';
import { cn } from '../../utils/cn';

const AUTO_DISMISS_MS = 6000;

/**
 * RL-070 Sub-slice 4 — Signal-Slate toast.
 *
 * Refresh of the bottom-right toast for transient notices (format-on-save
 * parse errors, missing formatter binaries, license activation outcomes,
 * web-update banner overflow). Now ships with four semantic tones
 * (success, info, warning, error) — each with its own icon, ramp, and
 * auto-dismiss behaviour.
 *
 * Auto-dismiss is suppressed when the tone is `error` so the user does
 * not lose actionable copy by looking away. Other tones still expire
 * after AUTO_DISMISS_MS.
 *
 * Visual contract:
 *
 *   - Subtle border-tone tint, never solid color blocks.
 *   - Leading icon column (16px) for instant tone recognition.
 *   - Body uses Eyebrow-less heading + small detail row when present.
 *   - Dismiss button stays muted until hover.
 */
export function StatusNoticeBanner() {
  const { t } = useTranslation();
  const notice = useUIStore((state) => state.statusNotice);
  const dismissStatusNotice = useUIStore((state) => state.dismissStatusNotice);

  // RL-101 fold B — track whether the visible notice ever fires a
  // CTA so the auto-dismiss timeout doesn't mis-attribute a
  // user-triggered close as `'auto'`.
  const ctaFiredRef = useRef(false);
  useEffect(() => {
    ctaFiredRef.current = false;
  }, [notice?.id]);

  useEffect(() => {
    if (!notice) return;
    // Errors stick — the user has to dismiss them.
    if (notice.tone === 'error') return undefined;
    const timeout = window.setTimeout(() => {
      // If the user clicked a CTA the dismiss already fired as
      // `'cta'`; this auto-timeout would otherwise also fire and
      // double-report. Skip when we know a CTA already ran.
      if (ctaFiredRef.current) return;
      dismissStatusNotice('auto');
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [notice, dismissStatusNotice]);

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
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
      data-testid="status-notice-banner"
      data-tone={notice.tone}
      className={cn(
        'pointer-events-auto fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-[1.1rem] border px-4 py-3 shadow-lg backdrop-blur',
        toneClasses(notice.tone)
      )}
    >
      <ToneIcon tone={notice.tone} />
      <div className="grid min-w-0 flex-1 gap-1 text-sm">
        <p className="font-medium leading-5">{t(notice.messageKey, notice.values)}</p>
        {notice.detail ? (
          <p className="max-h-32 overflow-auto text-[11.5px] leading-[1.45] text-muted">
            {notice.detail}
          </p>
        ) : null}
        {actions.length > 0 ? (
          <div
            className="mt-1 flex flex-wrap items-center gap-2"
            data-testid="status-notice-actions"
          >
            {actions.map((action) => (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => handleActionClick(action)}
                data-testid={`status-notice-action-${action.labelKey}`}
                className="rounded-full border border-foreground/20 bg-surface-strong/80 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
              >
                {t(action.labelKey)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissStatusNotice('manual')}
        aria-label={t('statusNotice.dismiss')}
        className="-mr-1 -mt-1 rounded-full p-1 text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function toneClasses(tone: StatusNoticeTone): string {
  switch (tone) {
    case 'success':
      return 'border-success/45 bg-success/10 text-foreground';
    case 'warning':
      return 'border-warning/45 bg-warning/12 text-foreground';
    case 'error':
      return 'border-error/45 bg-error/12 text-foreground';
    case 'info':
    default:
      return 'border-info/35 bg-info/10 text-foreground';
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
