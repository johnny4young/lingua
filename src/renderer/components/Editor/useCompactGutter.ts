import { useLayoutEffect, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { COMPACT_GUTTER_MAX_WIDTH } from './editorOptions';

/** True while the editor is narrower than the compact-gutter width; follows every relayout. */
export function useCompactGutter(editor: Parameters<OnMount>[0] | null): boolean {
  const [compact, setCompact] = useState(false);
  // Layout effect, so a narrow editor never paints its full gutter first.
  useLayoutEffect(() => {
    if (!editor) return;
    // Layout width is the whole editor, so toggling the gutter never flips it back.
    // A hidden editor lays out at 0; keep the last answer so it does not relayout twice on reshow.
    const update = (width: number) => {
      if (width > 0) setCompact(width < COMPACT_GUTTER_MAX_WIDTH);
    };
    update(editor.getLayoutInfo().width);
    const listener = editor.onDidLayoutChange(info => update(info.width));
    return () => listener.dispose();
  }, [editor]);
  return compact;
}
