import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getResolvedLocalEngine } from '../../runtime/duckdbClient';
import { useSettingsStore } from '../../stores/settingsStore';
import { SpecRow } from '../ui/SpecRow';
import { Select } from './shared';

/** Native or WASM Local engine; shown only where the desktop build ships DuckDB's binding. */
export function SqlLocalEngineRow() {
  const { t } = useTranslation();
  // Anything a stale store holds other than `native` reads as WASM, as the engine factory does.
  const preference = useSettingsStore(state => (state.sqlWorkspaceLocalEngine === 'native' ? 'native' : 'wasm'));
  const setPreference = useSettingsStore(state => state.setSqlWorkspaceLocalEngine);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.lingua?.sqlLocal;
    if (!bridge) return;
    let cancelled = false;
    bridge
      .status()
      .then(status => {
        if (!cancelled) setAvailable(status.available);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;
  const fellBack = preference === 'native' && getResolvedLocalEngine()?.fallback === 'failed';

  return (
    <SpecRow
      label={t('settings.editor.sqlWorkspace.localEngine.label')}
      description={t('settings.editor.sqlWorkspace.localEngine.hint')}
      control={
        <div className="flex flex-col items-end gap-1.5">
          <Select
            value={preference}
            onChange={event => setPreference(event.target.value === 'native' ? 'native' : 'wasm')}
            aria-label={t('settings.editor.sqlWorkspace.localEngine.label')}
            data-testid="settings-sql-local-engine"
          >
            <option value="native">{t('settings.editor.sqlWorkspace.localEngine.option.native')}</option>
            <option value="wasm">{t('settings.editor.sqlWorkspace.localEngine.option.wasm')}</option>
          </Select>
          {fellBack ? (
            <p className="text-caption text-fg-subtle" data-testid="settings-sql-local-engine-fallback">
              {t('settings.editor.sqlWorkspace.localEngine.fallback')}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
