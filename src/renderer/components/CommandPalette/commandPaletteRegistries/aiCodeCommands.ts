import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { BuildCommandPaletteModelArgs, CommandEntry } from '../commandPaletteModelTypes';

type AiCodeArgs = Pick<BuildCommandPaletteModelArgs, 'onExplainSelectedCode' | 'onEditSelectedCode' | 'onClose'>;

/** Explain and edit the current selection, or the whole buffer, with the AI endpoint; wired only when LOCAL_AI is held. */
export function buildAiCodeCommands(args: AiCodeArgs, translate: (key: string) => string): CommandEntry[] {
  const { onExplainSelectedCode, onEditSelectedCode, onClose } = args;
  return [
    ...(onExplainSelectedCode
      ? [
          buildActionCommand(
            'action-explain-selected-code',
            translate('command.explainCode'),
            translate('command.explainCodeDescription'),
            ['explain', 'code', 'ai', 'describe', 'selection', 'explicar', 'código', 'ia', 'selección'],
            () => {
              onExplainSelectedCode();
              onClose();
            }
          ),
        ]
      : []),
    ...(onEditSelectedCode
      ? [
          buildActionCommand(
            'action-edit-selected-code',
            translate('command.editCode'),
            translate('command.editCodeDescription'),
            ['edit', 'rewrite', 'refactor', 'fix', 'ai', 'selection', 'editar', 'reescribir', 'corregir', 'ia', 'selección'],
            () => {
              onEditSelectedCode();
              onClose();
            }
          ),
        ]
      : []),
  ];
}
