import { Clock, Loader2, SendHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/httpBuilderCatalog';
import { CommandBarVerb, type CommandBarVerbItem } from '../Chrome/CommandBarSlot';
import { tintedSend, type HttpTint } from './httpScopeColors';

/** Where the active request stands with the offline queue. */
export interface HttpSendQueue {
  /** Offline toward a host that needs the internet: Send queues instead. */
  willQueue: boolean;
  /** Held while offline, or back online and waiting for Send now. */
  state: 'queued' | 'ready' | null;
  onRemove: () => void;
}

/**
 * The HTTP tab's verb: Send, Stop while a request is in flight, and the
 * offline states (queue it, queued, Send now). The split menu holds Copy as.
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
  copyItems,
  copyDisabled = false,
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
  copyItems?: readonly CommandBarVerbItem[];
  copyDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const copyMenu = copyItems
    ? {
        label: t('httpWorkspace.editor.copyAs.label'),
        testId: 'http-request-editor-copy-menu',
        listTestId: 'http-request-editor-copy-menu-list',
        items: copyItems,
        disabled: copyDisabled,
      }
    : undefined;
  if (isExecuting) {
    // In flight, the verb becomes Stop; the previous response stays on screen.
    return (
      <CommandBarVerb
        running
        label={t('httpWorkspace.editor.stop.label')}
        icon={<Loader2 size={12} className="animate-spin" />}
        onClick={() => onStop?.()}
        testId="http-request-editor-stop"
        {...(copyMenu ? { menu: copyMenu, menuWhileRunning: true } : {})}
      />
    );
  }
  if (queue?.state === 'queued') {
    return (
      <span
        data-testid="http-request-editor-queued"
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-r-lg pl-3 pr-1 text-body-sm text-fg-muted"
      >
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
    <CommandBarVerb
      label={label}
      icon={queue?.willQueue && queue.state === null ? <Clock size={13} /> : <SendHorizontal size={13} />}
      shortcut={combo}
      onClick={onSend}
      disabled={disabled}
      {...(describedBy ? { describedBy } : {})}
      title={`${label} · ${t('httpWorkspace.editor.send.shortcutHint', { combo })}`}
      testId="http-request-editor-send"
      data={{
        'data-queue': queue?.state ?? (queue?.willQueue ? 'will-queue' : 'none'),
        ...(tint ? { 'data-tinted': 'true' } : {}),
      }}
      {...(tint ? { style: tintedSend(tint), className: 'hover:brightness-110' } : {})}
      {...(copyMenu ? { menu: copyMenu } : {})}
    />
  );
}
