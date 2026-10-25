import { useEffect, useState, type ComponentType } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../stores/editorStore';
import { useExplainPanelStore, type ExplainTarget } from '../../stores/explainPanelStore';
import { useResultStore } from '../../stores/resultStore';

type PanelComponent = ComponentType<{ target: ExplainTarget }>;

let panelPromise: Promise<{ ExplainErrorPanel: PanelComponent }> | null = null;

/**
 * Mounts the anchored explain panel beside the editor while its tab is active.
 * An unpinned panel follows its error: a run that changes or clears it closes
 * the panel, and threads of closed tabs are dropped.
 */
export function ExplainPanelHost() {
  const target = useExplainPanelStore((s) => s.target);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabIds = useEditorStore(useShallow((s) => s.tabs.map((tab) => tab.id)));
  const [Panel, setPanel] = useState<PanelComponent | null>(null);
  const shown = target !== null && target.tabId === activeTabId;

  useEffect(() => useExplainPanelStore.getState().keepThreads(tabIds), [tabIds]);

  useEffect(() => {
    if (!target) return;
    const messageAtOpen = useResultStore.getState().error?.message ?? null;
    return useResultStore.subscribe((state) => {
      if ((state.error?.message ?? null) === messageAtOpen || useExplainPanelStore.getState().pinned) return;
      useExplainPanelStore.getState().close();
    });
  }, [target]);

  useEffect(() => {
    if (!shown || Panel) return;
    let active = true;
    panelPromise ??= import('./ExplainErrorPanel');
    void panelPromise
      .then((module) => {
        if (active) setPanel(() => module.ExplainErrorPanel);
      })
      .catch((error: unknown) => console.error('[ai] failed to load the explain panel', error));
    return () => {
      active = false;
    };
  }, [shown, Panel]);

  return shown && Panel ? <Panel key={`${target.tabId}:${target.errorMessage}`} target={target} /> : null;
}
