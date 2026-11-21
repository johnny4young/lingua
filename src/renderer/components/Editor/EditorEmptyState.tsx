import { useTranslation } from 'react-i18next';
import '../../i18n/startCatalog';
import '../Start/start.css';
import { useEditorStore } from '../../stores/editorStore';
import { openHttpWorkspaceTab, openSqlWorkspaceTab } from '../../runtime/openWorkspaceTab';
import { SEEDED_SCRATCHPAD_NAME, seededScratchpadTab } from '../../onboarding/seedScratchpad';
import { requestSqlSample } from '../SqlWorkspace/pendingSqlSample';
import { StartNew } from '../Start/StartNew';
import { StartPickUp } from '../Start/StartPickUp';
import { StartTemplates } from '../Start/StartTemplates';

const SAMPLE_REQUEST_URL = 'https://jsonplaceholder.typicode.com/todos/1';

function openSampleTable(): void {
  requestSqlSample();
  openSqlWorkspaceTab();
}

async function openSampleRequest(name: string): Promise<void> {
  const [{ useWorkspaceToolStore }, { createBlankHttpRequest }] = await Promise.all([
    import('../../stores/workspaceToolStore'),
    import('../../../shared/httpWorkspaceSchema'),
  ]);
  useWorkspaceToolStore.getState().createRequest({
    ...createBlankHttpRequest({ id: crypto.randomUUID(), name }),
    url: SAMPLE_REQUEST_URL,
  });
  openHttpWorkspaceTab();
}

function StarterChips() {
  const { t } = useTranslation();
  const starters = [
    { id: 'welcome', label: SEEDED_SCRATCHPAD_NAME, open: () => useEditorStore.getState().addTab(seededScratchpadTab()) },
    { id: 'sample-table', label: t('start.try.sampleTable'), open: openSampleTable },
    { id: 'sample-request', label: t('start.try.sampleRequest'), open: () => void openSampleRequest(t('start.try.sampleRequestName')) },
  ];
  return (
    <div className="start-small mt-4 flex flex-wrap items-center gap-2 text-fg-muted">
      <span>{t('start.try.label')}</span>
      {starters.map(starter => (
        <button
          key={starter.id}
          type="button"
          onClick={starter.open}
          data-testid={`start-try-${starter.id}`}
          className="start-chip focus-ring inline-flex items-center rounded-md bg-bg-panel-alt text-fg-muted transition-colors hover:text-fg-base"
        >
          {starter.label}
        </button>
      ))}
    </div>
  );
}

/** Start: what last answered, a new scratch file or workspace, and the templates. */
export function EditorEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto bg-bg-base" data-testid="start-page">
      <div className="start-inner">
        <h1 className="start-headline font-display italic tracking-[-0.03em] text-fg-base">
          {t('start.headline')}
          <span className="start-headline-dot">.</span>
        </h1>
        <StarterChips />
        <StartPickUp />
        <StartNew />
        <StartTemplates />
      </div>
    </div>
  );
}
