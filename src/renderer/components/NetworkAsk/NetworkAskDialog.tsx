import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { answerNetworkQuestion, useNetworkAskStore } from '../../stores/networkAskStore';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';

/**
 * Asks whether running code may reach a host, under the Ask network policy.
 * The run waits (its timeout paused) until one of the two answers; the answer
 * holds for that host for the rest of the tab's session.
 */
export function NetworkAskDialog() {
  const { t } = useTranslation();
  const question = useNetworkAskStore(state => state.queue[0]);
  const blockRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (question) blockRef.current?.focus();
  }, [question]);

  if (!question) return null;

  const block = () => answerNetworkQuestion(question.id, false);
  const handleEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    block();
  };

  return (
    <OverlayBackdrop align="center" onClose={block} onKeyDown={handleEscape}>
      <OverlayCard
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="network-ask-title"
        aria-describedby="network-ask-body"
        className="w-[min(92vw,480px)] max-w-none"
        data-testid="network-ask-dialog"
      >
        <div className="surface-header px-5 py-4">
          <h2 id="network-ask-title" className="font-display text-h2 font-semibold text-foreground">
            {t('networkAsk.title')}
          </h2>
        </div>
        <div id="network-ask-body" className="space-y-2 px-5 py-5 text-body text-fg-muted">
          <p>{t('networkAsk.body', { runtime: t(`networkAsk.runtime.${question.runtime}`) })}</p>
          <p
            className="break-all rounded-md border border-border-subtle bg-bg-inset px-3 py-2 font-mono text-body-sm text-fg-base"
            data-testid="network-ask-host"
          >
            {question.host}
          </p>
          <p className="text-body-sm text-fg-subtle">{t('networkAsk.scope')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 px-5 py-4">
          <button
            ref={blockRef}
            type="button"
            className="button-secondary"
            onClick={block}
            data-testid="network-ask-block"
          >
            {t('networkAsk.block')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => answerNetworkQuestion(question.id, true)}
            data-testid="network-ask-allow"
          >
            {t('networkAsk.allow')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
