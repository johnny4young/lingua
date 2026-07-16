import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import { trackSqlStorageMode } from '../../hooks/sqlWorkspaceTelemetry';
import {
  clearPersistedSqlDatabase,
  configureDuckDbPersistence,
  flushAndReleaseDuckDbEngine,
  getDuckDbEngine,
  getResolvedSqlStorageMode,
  getResolvedSqlStorageRequestMode,
  isOpfsStorageAvailable,
} from '../../runtime/duckdbClient';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { SpecCard, SpecRow, SettingsSection } from '../ui/SpecRow';
import { Select, Toggle } from './shared';

/**
 * RL-097 Slice 3 fold D — SQL query timeout presets (milliseconds). The
 * setter clamps to [1s, 5min]; these are the surfaced choices. The label
 * key per preset lives in `settings.editor.sqlWorkspace.queryTimeout.*`.
 */
const SQL_QUERY_TIMEOUT_PRESETS: ReadonlyArray<{
  ms: number;
  labelKey: string;
}> = [
  { ms: 5_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option5s' },
  { ms: 15_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option15s' },
  { ms: 30_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option30s' },
  { ms: 60_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option60s' },
  { ms: 300_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option5m' },
];

const SQL_ROW_DISPLAY_LIMITS: ReadonlyArray<100 | 500 | 1000 | 5000> = [
  100, 500, 1000, 5000,
];

export function SqlWorkspaceSettingsSection() {
  const sqlWorkspaceRowDisplayLimit = useSettingsStore(
    (state) => state.sqlWorkspaceRowDisplayLimit
  );
  const setSqlWorkspaceRowDisplayLimit = useSettingsStore(
    (state) => state.setSqlWorkspaceRowDisplayLimit
  );
  const sqlWorkspaceQueryTimeoutMs = useSettingsStore(
    (state) => state.sqlWorkspaceQueryTimeoutMs
  );
  const setSqlWorkspaceQueryTimeoutMs = useSettingsStore(
    (state) => state.setSqlWorkspaceQueryTimeoutMs
  );
  const sqlWorkspacePersistTables = useSettingsStore(
    (state) => state.sqlWorkspacePersistTables
  );
  const setSqlWorkspacePersistTables = useSettingsStore(
    (state) => state.setSqlWorkspacePersistTables
  );
  const { t, i18n } = useTranslation();

  // RL-097 Slice 3 (SQL OPFS) — whether this browser exposes OPFS at
  // all. When false the toggle still works (the runtime falls back to
  // in-memory + notifies) but we surface an inline note so the user
  // understands persistence won't take.
  const opfsAvailable = isOpfsStorageAvailable();

  const reconnectDuckDbAndNotify = async (successMessageKey: string) => {
    configureDuckDbPersistence(sqlWorkspacePersistTables);
    try {
      await getDuckDbEngine();
    } catch (err) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
      return;
    }
    const resolved = getResolvedSqlStorageMode();
    const requested = getResolvedSqlStorageRequestMode();
    useWorkspaceSqlStore.getState().setStorageMode(resolved, requested);
    trackSqlStorageMode(resolved, requested);
    const fellBack = requested === 'opfs' && resolved === 'memory';
    useUIStore.getState().pushStatusNotice({
      tone: fellBack ? 'warning' : 'success',
      messageKey: fellBack
        ? 'sqlWorkspace.storage.unavailableNotice'
        : successMessageKey,
    });
  };

  // RL-097 Slice 3 (SQL OPFS) fold E — delete the persisted database.
  // Destructive (drops every saved table + row), so it confirms first.
  // `clearPersistedSqlDatabase` terminates the engine before removing
  // the OPFS file. Reconnect immediately afterwards so the SQL panel chip
  // reflects the fresh backing instead of staying stale until the next run.
  const handleClearSqlData = () => {
    if (
      !window.confirm(
        t('settings.editor.sqlWorkspace.persistTables.clearConfirm')
      )
    ) {
      return;
    }
    void (async () => {
      await clearPersistedSqlDatabase();
      await reconnectDuckDbAndNotify(
        'settings.editor.sqlWorkspace.persistTables.cleared'
      );
    })();
  };

  // RL-097 Slice 3 (SQL OPFS) fold E — apply the persistence toggle to
  // the live engine without a full reload. Terminating drops the current
  // session's in-memory tables, so it confirms first. Re-instantiates,
  // records the resolved mode (chip updates live), and fires the
  // storage-mode telemetry for the new resolution.
  const handleReconnectSql = () => {
    if (
      !window.confirm(
        t('settings.editor.sqlWorkspace.persistTables.reconnectConfirm')
      )
    ) {
      return;
    }
    void (async () => {
      await flushAndReleaseDuckDbEngine();
      await reconnectDuckDbAndNotify(
        'settings.editor.sqlWorkspace.persistTables.reconnected'
      );
    })();
  };

  return (
    <SettingsSection
      eyebrow={t('settings.editor.sqlWorkspace.title')}
      description={t('settings.editor.sqlWorkspace.description')}
    >
      <SpecCard>
        <SpecRow
          label={t('settings.editor.sqlWorkspace.rowDisplayLimit.label')}
          description={t('settings.editor.sqlWorkspace.rowDisplayLimit.hint')}
          control={
            <Select
              value={sqlWorkspaceRowDisplayLimit}
              onChange={(event) =>
                setSqlWorkspaceRowDisplayLimit(
                  Number(event.target.value) as 100 | 500 | 1000 | 5000
                )
              }
              aria-label={t('settings.editor.sqlWorkspace.rowDisplayLimit.label')}
              data-testid="settings-sql-row-display-limit"
            >
              {SQL_ROW_DISPLAY_LIMITS.map((limit) => (
                <option key={limit} value={limit}>
                  {formatNumber(limit, i18n.language)}
                </option>
              ))}
            </Select>
          }
        />

        <SpecRow
          label={t('settings.editor.sqlWorkspace.queryTimeout.label')}
          description={t('settings.editor.sqlWorkspace.queryTimeout.hint')}
          control={
            <Select
              value={sqlWorkspaceQueryTimeoutMs}
              onChange={(event) =>
                setSqlWorkspaceQueryTimeoutMs(Number(event.target.value))
              }
              aria-label={t('settings.editor.sqlWorkspace.queryTimeout.label')}
              data-testid="settings-sql-query-timeout"
            >
              {SQL_QUERY_TIMEOUT_PRESETS.map((preset) => (
                <option key={preset.ms} value={preset.ms}>
                  {t(preset.labelKey)}
                </option>
              ))}
            </Select>
          }
        />

        {/* RL-097 Slice 3 (SQL OPFS) — opt into persisting the DuckDB
            database to OPFS. Off by default; the runtime falls back to
            in-memory when OPFS is unavailable. Takes effect on the next
            reload or via the Reconnect now action below. */}
        <SpecRow
          label={t('settings.editor.sqlWorkspace.persistTables.label')}
          description={
            opfsAvailable
              ? t('settings.editor.sqlWorkspace.persistTables.hint')
              : `${t('settings.editor.sqlWorkspace.persistTables.hint')} ${t('settings.editor.sqlWorkspace.persistTables.unavailable')}`
          }
          last
          control={
            <Toggle
              value={sqlWorkspacePersistTables}
              onChange={() =>
                setSqlWorkspacePersistTables(!sqlWorkspacePersistTables)
              }
              aria-label={t('settings.editor.sqlWorkspace.persistTables.label')}
            />
          }
        />
      </SpecCard>

      {/* RL-097 Slice 3 (SQL OPFS) folds E — apply the toggle to the
          live engine without a reload, and wipe the persisted database.
          Both are session-affecting, so each confirms first. */}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="button-secondary"
          onClick={handleReconnectSql}
          data-testid="settings-sql-reconnect"
        >
          {t('settings.editor.sqlWorkspace.persistTables.reconnect')}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={handleClearSqlData}
          data-testid="settings-sql-clear-data"
        >
          {t('settings.editor.sqlWorkspace.persistTables.clear')}
        </button>
      </div>
    </SettingsSection>
  );
}
