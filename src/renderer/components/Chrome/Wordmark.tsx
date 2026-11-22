import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

/**
 * The wordmark set live from the bundled Fraunces Italic: a dotless i with the
 * dot drawn in pulse, as in assets/brand/wordmark.svg.
 */
export function Wordmark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('chrome.mark.aria')}
      data-testid="app-wordmark"
      className={cn(
        'relative inline-block shrink-0 whitespace-nowrap font-display text-[21px] font-[520] italic leading-[1.2] tracking-[-0.01em] text-fg-base [font-variation-settings:"SOFT"_100,"WONK"_1]',
        className
      )}
    >
      <span>
        l
        <span className="relative">
          ı
          <span
            data-testid="app-wordmark-dot"
            className="absolute left-1/2 top-[0.265em] ml-[0.15em] size-[0.175em] rounded-full bg-pulse"
          />
        </span>
        ngua
      </span>
    </span>
  );
}
