import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { BuildCommandPaletteModelArgs, CommandEntry } from '../commandPaletteModelTypes';

type SelectionTransferArgs = Pick<
  BuildCommandPaletteModelArgs,
  'onCopyReference' | 'onCopyWithContext' | 'editorSelectionAvailable' | 'onClose'
>;

export function buildSelectionTransferCommands(
  args: SelectionTransferArgs,
  translate: (key: string) => string
): CommandEntry[] {
  const {
    onCopyReference,
    onCopyWithContext,
    editorSelectionAvailable = false,
    onClose,
  } = args;
  if (!onCopyReference || !onCopyWithContext) return [];

  return [
    {
      ...buildActionCommand(
        'action-copy-reference',
        translate('editor.selectionTransfer.reference.label'),
        translate(editorSelectionAvailable
          ? 'editor.selectionTransfer.reference.description'
          : 'editor.selectionTransfer.noSelection'),
        ['copy', 'reference', 'selection', 'line', 'copiar', 'referencia'],
        () => {
          if (!editorSelectionAvailable) return;
          onCopyReference();
          onClose();
        }
      ),
      disabled: !editorSelectionAvailable,
    },
    {
      ...buildActionCommand(
        'action-copy-with-context',
        translate('editor.selectionTransfer.context.label'),
        translate(editorSelectionAvailable
          ? 'editor.selectionTransfer.context.description'
          : 'editor.selectionTransfer.noSelection'),
        ['copy', 'context', 'selection', 'code', 'copiar', 'contexto'],
        () => {
          if (!editorSelectionAvailable) return;
          onCopyWithContext();
          onClose();
        }
      ),
      disabled: !editorSelectionAvailable,
    },
  ];
}
