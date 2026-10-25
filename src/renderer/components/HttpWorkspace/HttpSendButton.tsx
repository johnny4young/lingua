import { Clock, Loader2, SendHorizontal, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/httpBuilderCatalog';
import { tintedSend, type HttpTint } from './httpScopeColors';

/** Where the active request stands with the offline queue. */
export interface HttpSendQueue {
  /** Offline toward a host that needs the internet: Send queues instead. */
  willQueue: boolean;
  /** Held while offline, or back online and waiting for Send now. */
  state: 'queued' | 'ready' | null;
  onRemove: () => void;
}

const PRIMARY =
  'focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The request row's primary action: Send, Stop while a request is in flight,
 * and the offline states (queue it, queued, Send now).
 */
export function HttpSendButton({
  isExecuting,
  disabled,
  describedBy,
  combo,
  queue,
  onSend,
  onStop,
  tint,
}: {
  isExecuting: boolean;
  disabled: boolean;
  describedBy?: string;
  combo: string;
  queue?: HttpSendQueue;
  onSend: () => void;
  onStop?: () => void;
  /** The active environment's colour, so a send to production looks like one. */
  tint?: HttpTint;
}) {
  const { t } = useTranslation();
  if (isExecuting) {
    // In flight, the primary button becomes Stop; the previous response stays on screen.
    return (
      <button
        type="button"
        onClick={onStop}
        data-testid="http-request-editor-stop"
        aria-label={t('httpWorkspace.editor.stop.label')}
        title={t('httpWorkspace.editor.stop.label')}
        className="focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-bg-inset px-3 text-body-sm font-semibold text-fg-base transition-colors hover:bg-bg-muted"
      >
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        <Square size={12} aria-hidden="true" />
        <span>{t('httpWorkspace.editor.stop.label')}</span>
      </button>
    );
  }
  if (queue?.state === 'queued') {
    return (
      <span data-testid="http-request-editor-queued" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-bg-inset pl-3 pr-1 text-body-sm text-fg-muted">
        <Clock size={14} aria-hidden="true" />
        <span>{t('httpWorkspace.offline.queuedLabel')}</span>
        <button
          type="button"
          onClick={queue.onRemove}
          data-testid="http-request-editor-unqueue"
          aria-label={t('httpWorkspace.offline.remove')}
          title={t('httpWorkspace.offline.remove')}
          className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg-base"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </span>
    );
  }
  const label =
    queue?.state === 'ready'
      ? t('httpWorkspace.offline.sendNow')
      : queue?.willQueue
        ? t('httpWorkspace.offline.sendWhenOnline')
        : t('httpWorkspace.editor.send.label');
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={disabled}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      data-testid="http-request-editor-send"
      data-queue={queue?.state ?? (queue?.willQueue ? 'will-queue' : 'none')}
      aria-label={label}
      title={`${label} · ${t('httpWorkspace.editor.send.shortcutHint', { combo })}`}
      className={tint ? `${PRIMARY} hover:brightness-110` : PRIMARY}
      {...(tint ? { 'data-tinted': true, style: tintedSend(tint) } : {})}
    >
      {queue?.willQueue && queue.state === null ? <Clock size={14} aria-hidden="true" /> : <SendHorizontal size={14} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
