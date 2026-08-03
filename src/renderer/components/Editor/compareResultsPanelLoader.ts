import type { ComponentType } from 'react';
import type { CompareResultsPanelProps } from './CompareResultsPanel';

interface CompareResultsPanelModule {
  CompareResultsPanel: ComponentType<CompareResultsPanelProps>;
}

let panelPromise: Promise<CompareResultsPanelModule> | null = null;

/**
 * Share one comparison implementation across activations.
 *
 * Failed module fetches are intentionally left cached for this document:
 * browsers retain failed module URLs in the module map, so repeating the same
 * import is not a reliable recovery path. The host offers a page reload, which
 * creates a fresh module map and can fetch a restored chunk.
 */
export function loadCompareResultsPanel(): Promise<CompareResultsPanelModule> {
  panelPromise ??= import('./CompareResultsPanel');
  return panelPromise;
}
