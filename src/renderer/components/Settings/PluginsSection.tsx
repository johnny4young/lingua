import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../../stores/pluginStore';
import { EmptyState } from '../ui/EmptyState';
import { Section } from './shared';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

interface PluginDiagnosticRecord {
  diagnostic?: PluginDiagnostic;
  message: string;
  pluginId: string;
}

function formatPluginStatus(status: string, t: TranslationFn): string {
  const key = `plugins.state.${status}`;
  const label = t(key);
  return label === key ? t('plugins.state.unrecognized') : label;
}

function formatPluginDiagnostic(plugin: PluginDiagnosticRecord, t: TranslationFn): string {
  const diagnostic = plugin.diagnostic;
  if (!diagnostic) return plugin.message;

  switch (diagnostic.key) {
    case 'manifestObject':
      return t('plugins.diagnostic.manifestObject');
    case 'unknownFields':
      return t('plugins.diagnostic.unknownFields', diagnostic.params);
    case 'missingPluginId':
      return t('plugins.diagnostic.missingPluginId');
    case 'unsafeId':
      return t('plugins.diagnostic.unsafeId', diagnostic.params);
    case 'invalidFieldType':
      return t('plugins.diagnostic.invalidFieldType', diagnostic.params);
    case 'invalidVersion':
      return t('plugins.diagnostic.invalidVersion', diagnostic.params);
    case 'unsupportedApiVersion':
      return t('plugins.diagnostic.unsupportedApiVersion', diagnostic.params);
    case 'minAppVersion':
      return t('plugins.diagnostic.minAppVersion', diagnostic.params);
    case 'maxAppVersion':
      return t('plugins.diagnostic.maxAppVersion', diagnostic.params);
    case 'unknown':
      return t('plugins.diagnostic.unknown', {
        pluginId: diagnostic.params?.pluginId ?? plugin.pluginId,
      });
    case 'disabled':
      return t('plugins.diagnostic.disabled');
    case 'loaded':
      return t('plugins.diagnostic.loaded');
    case 'loadFailed':
      return t('plugins.diagnostic.loadFailed', diagnostic.params);
    case 'unavailable':
      return t('plugins.diagnostic.unavailable', {
        pluginId: diagnostic.params?.pluginId ?? plugin.pluginId,
      });
    default:
      return plugin.message;
  }
}

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
        <div className="rounded-[1.35rem] border border-dashed border-border/80 px-4 py-8">
          <EmptyState
            icon={<Puzzle size={18} aria-hidden="true" />}
            title={t('plugins.empty')}
            description={t('plugins.description')}
          />
        </div>
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
                    {formatPluginStatus(plugin.status, t)}
                  </p>
                </div>
                <p className="text-[11px] text-muted">{plugin.pluginId}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                {formatPluginDiagnostic(plugin, t)}
              </p>
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
