import type { ComponentType } from 'react';

export interface EditorTabContextMenuProps {
  readonly anchor: { readonly top: number; readonly left: number };
  readonly tabName: string;
  readonly isLastTab: boolean;
  readonly isRightmost: boolean;
  readonly onClose: () => void;
  readonly onCloseTab: () => void;
  readonly onCloseOthers: () => void;
  readonly onCloseToRight: () => void;
  readonly onCloseAll: () => void;
  readonly onRename: () => void;
  readonly onDuplicate: () => void;
}

interface EditorTabContextMenuModule {
  EditorTabContextMenu: ComponentType<EditorTabContextMenuProps>;
}

let contextMenuPromise: Promise<EditorTabContextMenuModule> | null = null;

/**
 * Share one editor-tab context-menu implementation across activations.
 *
 * Failed module fetches remain cached for the current document because
 * browsers retain failed module URLs. The host offers a page reload instead
 * of presenting a retry that cannot reliably recover.
 */
export function loadEditorTabContextMenu(): Promise<EditorTabContextMenuModule> {
  contextMenuPromise ??= import('./EditorTabContextMenu');
  return contextMenuPromise;
}
