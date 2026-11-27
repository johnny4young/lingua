import { useTranslation } from 'react-i18next';
import '../../i18n/startCatalog';
import '../Start/start.css';
import { StartNew } from '../Start/StartNew';
import { StartPickUp } from '../Start/StartPickUp';
import { StartPrompt } from '../Start/StartPrompt';
import { StartTemplates } from '../Start/StartTemplates';

/** Start: a line that answers, what last answered, a new scratch file or workspace, and the templates. */
export function EditorEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="start-page h-full overflow-auto" data-testid="start-page">
      <div className="start-inner">
        <h1 className="start-headline font-display italic tracking-[-0.03em] text-fg-base">
          {t('start.headline')}
          <span className="start-headline-dot">.</span>
        </h1>
        <StartPrompt />
        <StartPickUp />
        <StartNew />
        <StartTemplates />
      </div>
    </div>
  );
}
