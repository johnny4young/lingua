import { useTranslation } from 'react-i18next';
import type { ResolvedLocalEngine } from '../../runtime/duckdbClient';
import { useSettingsStore } from '../../stores/settingsStore';
import { SpecRow } from '../ui/SpecRow';
import { Select } from './shared';
import '../../i18n/sqlLocalEngineCatalog';

/** Native or WASM Local engine; shown where the desktop build ships DuckDB's binding, or where a stored `native` cannot run. */
export function SqlLocalEngineRow({ available, resolved }: { available: boolean | null; resolved: ResolvedLocalEngine | null }) {
  const { t } = useTranslation();
  // Anything a stale store holds other than `native` reads as WASM, as the engine factory does.
  const preference = useSettingsStore(state => (state.sqlWorkspaceLocalEngine === 'native' ? 'native' : 'wasm'));
  const setPreference = useSettingsStore(state => state.setSqlWorkspaceLocalEngine);

  if (available === null || (!available && preference !== 'native')) return null;
  const note = !available || (preference === 'native' && resolved?.fallback === 'failed') ? t('settings.editor.sqlWorkspace.localEngine.fallback') : null;

  return (
    <SpecRow
      label={t('settings.editor.sqlWorkspace.localEngine.label')}
      description={t('settings.editor.sqlWorkspace.localEngine.hint')}
      control={
        <div className="flex flex-col items-end gap-1.5">
          <Select
            value={available ? preference : 'wasm'}
            onChange={event => setPreference(event.target.value === 'native' ? 'native' : 'wasm')}
            aria-label={t('settings.editor.sqlWorkspace.localEngine.label')}
            data-testid="settings-sql-local-engine"
          >
            <option value="native" disabled={!available}>
              {t('settings.editor.sqlWorkspace.localEngine.option.native')}
            </option>
            <option value="wasm">{t('settings.editor.sqlWorkspace.localEngine.option.wasm')}</option>
          </Select>
          {note ? (
            <p className="text-caption text-fg-subtle" data-testid="settings-sql-local-engine-fallback">
              {note}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
