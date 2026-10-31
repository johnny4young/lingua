import { useEffect, useState, type ComponentType } from 'react';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { supportsRunRegions } from '../../utils/runRegions';
import type { RunRegionsProps } from './RunRegions';

type RunRegionsComponent = ComponentType<RunRegionsProps>;

let regionsPromise: Promise<{ RunRegions: RunRegionsComponent }> | null = null;

/** Loads run regions the first time a supported tab with a `%%` marker is open and the flag is on. */
export function RunRegionsHost({ editor, monaco }: Pick<RunRegionsProps, 'editor' | 'monaco'>) {
  const on = useSettingsStore(state => state.featureFlags.runRegions === true);
  const tab = useEditorStore(state => getActiveTab(state));
  const language = tab && supportsRunRegions(tab.language) ? tab.language : null;
  const wanted = on && language !== null && tab!.content.includes('%%');
  const [Regions, setRegions] = useState<RunRegionsComponent | null>(null);

  useEffect(() => {
    if (!wanted || Regions) return;
    let active = true;
    regionsPromise ??= import('./RunRegions');
    void regionsPromise
      .then(module => {
        if (active) setRegions(() => module.RunRegions);
      })
      .catch((error: unknown) => console.error('[run-regions] failed to load', error));
    return () => {
      active = false;
    };
  }, [wanted, Regions]);

  if (!Regions || !wanted || !tab || !language) return null;
  return <Regions key={tab.id} editor={editor} monaco={monaco} tabId={tab.id} language={language} content={tab.content} />;
}
