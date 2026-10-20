import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Trash2 } from 'lucide-react';
import { clearPersistedSqlDatabase, persistedSqlDatabaseBytes } from '../../runtime/duckdbClient';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { SpecRow } from '../ui/SpecRow';
import { formatBytes, type LinguaLocalStoreKey, type LocalStoreRow } from './privacyTrustHelpers';

interface LocalDataSummaryProps {
  rows: ReadonlyArray<LocalStoreRow>;
  capsuleCount: number;
  /** Removes one store without a notice; the summary posts one notice for the batch. */
  clearStore: (key: LinguaLocalStoreKey) => void;
  onCleared: () => void;
}

/**
 * The footprint row above the Local stores table: the stores, the SQL
 * workspace database in OPFS and the capsules held in memory, with one
 * Clear everything that chains the same clears behind a single confirm.
 */
export function LocalDataSummary({
  rows,
  capsuleCount,
  clearStore,
  onCleared,
}: LocalDataSummaryProps) {
  const { t } = useTranslation();
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  const [sqlBytes, setSqlBytes] = useState<number | null>(0);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const revealSupported = typeof window !== 'undefined' && window.lingua?.platform !== 'web';

  const readSqlBytes = useCallback(() => {
    void persistedSqlDatabaseBytes().then(setSqlBytes);
  }, []);
  useEffect(readSqlBytes, [readSqlBytes]);

  const storesBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const storesInUse = rows.filter(row => row.bytes > 0);
  const nothingToClear = storesInUse.length === 0 && sqlBytes === 0 && capsuleCount === 0;
  const sqlLabel =
    sqlBytes === null ? t('settings.privacy.localData.sqlInUse') : formatBytes(sqlBytes);

  const handleReveal = async () => {
    const result = await window.lingua.recovery.revealFolder();
    if (!result.ok) pushStatusNotice({ tone: 'warning', messageKey: 'recovery.openFolder.hint' });
  };

  const handleClearEverything = async () => {
    setClearing(true);
    try {
      for (const row of storesInUse) clearStore(row.key);
      // Releases the engine before deleting, so an open SQL tab cannot hold the file.
      if (sqlBytes !== 0) await clearPersistedSqlDatabase();
      const history = useExecutionHistoryStore.getState();
      for (const entry of history.capsuleEntries()) history.clearCapsule(entry.id);
      pushStatusNotice({ tone: 'success', messageKey: 'settings.privacy.localData.cleared' });
    } finally {
      setClearing(false);
      setConfirming(false);
      readSqlBytes();
      onCleared();
    }
  };

  return (
    <>
      <SpecRow
        label={t('settings.privacy.localData.label')}
        description={t('settings.privacy.localData.hint')}
        last
        control={
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-1.5">
              {revealSupported ? (
                <button
                  type="button"
                  onClick={() => void handleReveal()}
                  className="button-secondary h-[26px] gap-1.5 px-2.5 text-body-sm"
                  data-testid="privacy-local-data-reveal"
                >
                  <FolderOpen size={12} aria-hidden />
                  {t('settings.privacy.localData.reveal')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={nothingToClear || clearing}
                className="button-danger h-[26px] gap-1.5 px-2.5 text-body-sm disabled:opacity-40"
                data-testid="privacy-local-data-clear-all"
              >
                <Trash2 size={12} aria-hidden />
                {t('settings.privacy.localData.clearAll')}
              </button>
            </div>
            <span
              className="text-right text-caption text-fg-subtle"
              data-testid="privacy-local-data-total"
            >
              {t('settings.privacy.localData.total', {
                total: formatBytes(storesBytes + (sqlBytes ?? 0)),
                sql: sqlLabel,
                stores: rows.length,
                storesSize: formatBytes(storesBytes),
              })}
              {' · '}
              <span data-testid="privacy-capsules-retained">
                {t('settings.privacy.localData.capsules', { count: capsuleCount })}
              </span>
            </span>
          </div>
        }
      />
      {confirming ? (
        <ClearEverythingModal
          storeKeys={storesInUse.map(row => row.key)}
          includesLicense={storesInUse.some(row => row.key === 'lingua-license')}
          includesSql={sqlBytes !== 0}
          capsuleCount={capsuleCount}
          busy={clearing}
          onConfirm={() => void handleClearEverything()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

function ClearEverythingModal({
  storeKeys,
  includesLicense,
  includesSql,
  capsuleCount,
  busy,
  onConfirm,
  onCancel,
}: {
  storeKeys: readonly LinguaLocalStoreKey[];
  includesLicense: boolean;
  includesSql: boolean;
  capsuleCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Nested inside Settings: stop Escape here so the parent overlay stays open.
  const handleEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <OverlayBackdrop onClose={onCancel} onKeyDown={handleEscape}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-clear-all-title"
        className="w-[min(92vw,540px)] max-w-none"
        data-testid="privacy-clear-all-modal"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="privacy-clear-all-title"
            className="font-display text-h2 font-semibold text-foreground"
          >
            {t('settings.privacy.localData.confirm.title')}
          </h2>
        </div>
        <div className="space-y-3 px-5 py-5 text-body text-fg-muted">
          <p>{t('settings.privacy.localData.confirm.intro')}</p>
          <ul className="list-disc space-y-1 pl-5" data-testid="privacy-clear-all-items">
            {storeKeys.length > 0 ? (
              <li>
                {t('settings.privacy.localData.confirm.stores', { keys: storeKeys.join(', ') })}
              </li>
            ) : null}
            {includesLicense ? (
              <li className="text-warning-fg">{t('settings.privacy.localData.confirm.license')}</li>
            ) : null}
            {includesSql ? <li>{t('settings.privacy.localData.confirm.sql')}</li> : null}
            {capsuleCount > 0 ? (
              <li>{t('settings.privacy.localData.confirm.capsules', { count: capsuleCount })}</li>
            ) : null}
          </ul>
          <p className="text-body-sm text-fg-subtle">
            {t('settings.privacy.localData.confirm.kept')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 px-5 py-4">
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            data-testid="privacy-clear-all-cancel"
          >
            {t('settings.privacy.localStores.clear.cancel')}
          </button>
          <button
            type="button"
            className="button-danger-solid"
            onClick={onConfirm}
            disabled={busy}
            data-testid="privacy-clear-all-confirm"
          >
            {t('settings.privacy.localData.clearAllConfirm')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
