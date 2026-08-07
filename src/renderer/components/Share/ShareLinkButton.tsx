import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveTab } from '../../hooks/useActiveTab';
import { emitCommand } from '../../stores/commandBus';
import { useCommandListener } from '../../hooks/useCommandListener';
import { Tooltip } from '../ui/chrome';

const FEEDBACK_RESET_MS = 1000;

/**
 * Startup-safe share affordance.
 *
 * The button remains immediately available beside the result panel, but it
 * owns no encoding, clipboard, telemetry, or confirmation implementation.
 * Those concerns load through the single app-level ShareLinkController after
 * this component emits an explicit share.trigger command.
 */
export function ShareLinkButton() {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
  const [justCopied, setJustCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useCommandListener('share.succeeded', () => {
    setJustCopied(true);
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setJustCopied(false);
      resetTimerRef.current = null;
    }, FEEDBACK_RESET_MS);
  });

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const handleClick = useCallback(() => {
    emitCommand('share.trigger', { trigger: 'button' });
  }, []);

  if (!activeTab) return null;

  return (
    <Tooltip content={t('share.button.tooltip')}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={t('share.button.aria')}
        data-testid="result-panel-share-link"
        data-just-copied={justCopied ? 'true' : 'false'}
        className={`relative button-secondary inline-flex items-center justify-center px-2 py-1 ${
          justCopied ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-bg-panel-alt' : ''
        }`}
      >
        {justCopied ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <Share2 size={13} aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  );
}
