import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UtilitySuggestionId } from '../../clipboard/pasteHandlers';
import '../../i18n/clipboardChainsCatalog';

/** The live region stays mounted, since one inserted with its text is often not announced. */
export function ClipboardBanner({ kind }: { kind: UtilitySuggestionId | null }) {
  const { t } = useTranslation();
  return (
    <div role="status">
      {kind ? (
        <p
          data-testid="utility-clipboard-banner"
          className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-warning/45 bg-warning/10 px-2.5 py-2 text-caption text-warning-fg"
        >
          <Lightbulb size={14} aria-hidden className="shrink-0" />
          {t(`utilities.clipboard.banner.${kind}`)}
        </p>
      ) : null}
    </div>
  );
}
