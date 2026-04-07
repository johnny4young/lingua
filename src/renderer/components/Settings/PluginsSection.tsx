import { usePluginStore } from '../../stores/pluginStore';
import { Section } from './shared';

export function PluginsSection() {
  const installDirectory = usePluginStore((state) => state.installDirectory);
  const plugins = usePluginStore((state) => state.plugins);
  const refresh = usePluginStore((state) => state.refresh);

  return (
    <Section title="Plugins">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-300">Local plugin directory</p>
          <p className="mt-1 break-all text-xs text-gray-500">
            {installDirectory ?? 'Not available in this build'}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>
      {plugins.length === 0 ? (
        <p className="text-xs text-gray-500">No local plugins are installed.</p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.manifestPath}
              className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-200">{plugin.displayName}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">
                    {plugin.status}
                  </p>
                </div>
                <p className="text-[11px] text-gray-500">{plugin.pluginId}</p>
              </div>
              <p className="mt-2 text-xs text-gray-400">{plugin.message}</p>
              <p className="mt-2 break-all text-[11px] text-gray-600">{plugin.manifestPath}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
