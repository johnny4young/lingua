import type { ComponentType } from 'react';
import type { InlineResultWidgetsProps } from './InlineResultWidgets';

interface InlineResultWidgetsModule {
  InlineResultWidgets: ComponentType<InlineResultWidgetsProps>;
}

let widgetsPromise: Promise<InlineResultWidgetsModule> | null = null;

/**
 * Share one overlay implementation across runs.
 *
 * A failed module URL remains cached for the current document, matching the
 * browser module map. The host reports reload guidance instead of retrying a
 * request that cannot reliably recover without a new document.
 */
export function loadInlineResultWidgets(): Promise<InlineResultWidgetsModule> {
  widgetsPromise ??= import('./InlineResultWidgets');
  return widgetsPromise;
}

export type { InlineResultWidgetsProps };
