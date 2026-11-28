import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePortalMenu } from '../../hooks/usePortalMenu';
import { getAdapter } from '../../../shared/utilities/registry';
import { UTILITY_ADAPTER_IDS, type UtilityAdapterId } from '../../../shared/utilities/types';
import { TypeTag } from '../ui/answer';
import { readSendTargets, type SendTarget } from './sendTargets';
import { ADAPTER_ICON } from './utilityIcons';
import './sendOutput.css';
import '../../i18n/clipboardChainsCatalog';

type Translate = (key: string) => string;

/** The hash card names its algorithm, as the step it makes will run it. */
function adapterLabel(utilityId: UtilityAdapterId, t: Translate): string {
  const adapter = getAdapter(utilityId);
  const title = t(adapter?.titleKey ?? utilityId);
  const algorithm = utilityId === 'hash' ? (adapter?.defaultOptions() as { algorithm?: string } | undefined)?.algorithm : undefined;
  return algorithm ? `${title} · ${algorithm}` : title;
}

/** A tool's output changes per keystroke; the previews read it once typing pauses. */
const READ_DELAY_MS = 150;

/** The ranked targets for `output`; the last read stays on screen until the next one lands. */
function useSendTargets(output: string, exclude: UtilityAdapterId | undefined): readonly SendTarget[] {
  const [targets, setTargets] = useState<readonly SendTarget[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readSendTargets(output, exclude, controller.signal)
        .catch(() => [])
        .then((next) => {
          if (!controller.signal.aborted) setTargets(next);
        });
    }, READ_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [output, exclude]);
  return targets;
}

interface SendOutputCardsProps {
  /** The output the cards preview; picking a card sends what the caller reads at that moment. */
  readonly output: string;
  readonly onSend: (utilityId: UtilityAdapterId) => void;
  readonly testId: string;
  /** False while the output's source has not loaded. */
  readonly ready?: boolean;
  /** The adapter that made this output, never offered again. */
  readonly exclude?: UtilityAdapterId;
}

/** Up to three adapters for this output, each with its answer, and the rest behind +N. */
export function SendOutputCards({ output, onSend, testId, ready = true, exclude }: SendOutputCardsProps) {
  const { t } = useTranslation();
  const targets = useSendTargets(output, exclude);
  const { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger } = usePortalMenu();
  const shown = new Set(targets.map((target) => target.utilityId));
  const rest = UTILITY_ADAPTER_IDS.filter((id) => !shown.has(id));
  const heading = t('utilityPipeline.send.heading');
  const more = t('utilityPipeline.send.more', { count: rest.length });

  return (
    <section data-testid={testId} className="send-cards">
      <h3 className="type-tag">{heading}</h3>
      <div className="send-cards-row">
        {targets.map(({ utilityId, tag, preview }) => {
          const Icon = ADAPTER_ICON[utilityId];
          return (
            <button
              key={utilityId}
              type="button"
              disabled={!ready}
              onClick={() => onSend(utilityId)}
              data-testid={`${testId}-card`}
              data-utility-id={utilityId}
              className="send-card focus-ring"
            >
              <span className="send-card-title">
                <Icon size={12} aria-hidden="true" />
                <span className="truncate">{adapterLabel(utilityId, t)}</span>
              </span>
              {tag ? (
                <span className="send-card-answer">
                  <TypeTag>{tag}</TypeTag>
                  <span className="send-card-preview value-tone" data-tone="string" data-testid={`${testId}-preview`}>
                    {preview}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
        {targets.length > 0 ? (
          <button
            ref={triggerRef}
            type="button"
            disabled={!ready}
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={more}
            title={more}
            data-testid={`${testId}-more`}
            className="send-card send-card-more focus-ring"
          >
            +{rest.length}
          </button>
        ) : null}
      </div>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={more}
              data-testid={`${testId}-menu`}
              onKeyDown={onMenuKeyDown}
              // A long list scrolls in a short menu instead of covering the window.
              style={{ ...position, maxHeight: typeof position.maxHeight === 'number' ? `min(18rem, ${position.maxHeight}px)` : '18rem' }}
              className="dropdown-rich z-[1000] w-max min-w-[220px] max-w-[calc(100vw-16px)]"
            >
              {rest.map((utilityId) => {
                const Icon = ADAPTER_ICON[utilityId];
                return (
                  <button
                    key={utilityId}
                    type="button"
                    role="menuitem"
                    data-testid={`${testId}-option`}
                    data-utility-id={utilityId}
                    onClick={() => {
                      closeToTrigger();
                      onSend(utilityId);
                    }}
                    className="dropdown-rich-row flex w-full items-center gap-2.5 text-left"
                  >
                    <Icon size={13} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                    {adapterLabel(utilityId, t)}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </section>
  );
}
