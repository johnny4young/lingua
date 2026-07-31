import { useEffect, useState, type ComponentType } from 'react';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import {
  loadEditorTabContextMenu,
  type EditorTabContextMenuProps,
} from './editorTabContextMenuLoader';

type EditorTabContextMenuComponent = ComponentType<EditorTabContextMenuProps>;

/**
 * Activation boundary for editor-tab context actions.
 *
 * Tab rendering, activation, rename, close, overflow, and keyboard detection
 * stay eager. The portal menu and its action UI load only after right-click or
 * Shift+F10 opens a context menu. A failed module fetch closes the pending
 * request and reports the recovery path through Lingua's global notice surface.
 */
export function EditorTabContextMenuHost(props: EditorTabContextMenuProps) {
  const { onClose } = props;
  const [ContextMenu, setContextMenu] = useState<EditorTabContextMenuComponent | null>(null);
  const { error: pushErrorNotice } = useStatusNotice();

  useEffect(() => {
    if (ContextMenu) return;
    let active = true;
    void loadEditorTabContextMenu()
      .then(module => {
        if (!active) return;
        setContextMenu(() => module.EditorTabContextMenu);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[editor-tabs] failed to load the tab context menu', error);
        pushErrorNotice('editorTabs.menu.loadFailed');
        onClose();
      });
    return () => {
      active = false;
    };
  }, [ContextMenu, onClose, pushErrorNotice]);

  return ContextMenu ? <ContextMenu {...props} /> : null;
}
