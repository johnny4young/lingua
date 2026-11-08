import { useTranslation } from 'react-i18next';
import { HTTP_STARTERS, type StarterPatch } from './httpStarters';

const CHIP =
  'focus-ring rounded-md border border-border-subtle bg-bg-panel-alt px-3 py-1.5 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base';

/** A request with no URL yet: fill in a GET or POST to try, or paste a cURL command into the URL. */
export function HttpStarterRequests({ onApply }: { onApply: (patch: StarterPatch) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-center gap-2" data-testid="http-starter-requests">
      {HTTP_STARTERS.map(starter => (
        <button key={starter.id} type="button" data-testid={`http-starter-${starter.id}`} onClick={() => onApply(starter.patch)} className={CHIP}>
          {t(starter.labelKey)}
        </button>
      ))}
      <button
        type="button"
        data-testid="http-starter-paste-curl"
        // The URL field turns a pasted cURL command into the request.
        onClick={() => document.querySelector<HTMLInputElement>('[data-testid="http-request-editor-url"]')?.focus()}
        className={CHIP}
      >
        {t('httpWorkspace.starter.pasteCurl')}
      </button>
    </div>
  );
}
