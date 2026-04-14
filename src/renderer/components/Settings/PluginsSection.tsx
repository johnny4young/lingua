import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../../stores/pluginStore';
import { Section } from './shared';

export function PluginsSection() {
  const installDirectory = usePluginStore((state) => state.installDirectory);
  const plugins = usePluginStore((state) => state.plugins);
  const refresh = usePluginStore((state) => state.refresh);
  const { t } = useTranslation();

  return (
    <Section
      title={t('plugins.title')}
      description={t('plugins.description')}
    >
      <div className="rounded-[1.35rem] border border-border/80 bg-background-elevated/72 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('plugins.directory.label')}</p>
            <p className="mt-1 break-all text-xs leading-6 text-muted">
              {installDirectory ?? t('plugins.directory.unavailable')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="button-secondary shrink-0"
          >
            {t('plugins.actions.refresh')}
          </button>
        </div>
      </div>

      {plugins.length === 0 ? (
        <p className="rounded-[1.35rem] border border-dashed border-border/80 px-4 py-5 text-sm text-muted">
          {t('plugins.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.manifestPath}
              className="rounded-[1.35rem] border border-border/80 bg-background-elevated/72 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{plugin.displayName}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted">
                    {t(`plugins.state.${plugin.status}`)}
                  </p>
                </div>
                <p className="text-[11px] text-muted">{plugin.pluginId}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">{plugin.message}</p>
              <p className="mt-3 break-all text-[11px] leading-5 text-muted">
                {plugin.manifestPath}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
