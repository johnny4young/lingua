import { buildApplicationCommands } from './commandPaletteRegistries/application';
import { buildArtifactCommands } from './commandPaletteRegistries/artifacts';
import { buildEditorCommands } from './commandPaletteRegistries/editor';
import { buildLibraryCommands } from './commandPaletteRegistries/library';
import { buildUtilityCommands } from './commandPaletteRegistries/utilities';
import { buildWorkspaceCommands } from './commandPaletteRegistries/workspace';
import { identityTranslate } from './commandPaletteModelHelpers';
import type {
  BuildCommandPaletteModelArgs,
  CommandEntry,
  CommandPaletteRegistry,
} from './commandPaletteModelTypes';

export const COMMAND_PALETTE_DOMAIN_ORDER = [
  'library',
  'workspace',
  'artifacts',
  'editor',
  'application',
  'utilities',
] as const;

export type CommandPaletteDomain = (typeof COMMAND_PALETTE_DOMAIN_ORDER)[number];

export const COMMAND_PALETTE_REGISTRIES = {
  library: buildLibraryCommands,
  workspace: buildWorkspaceCommands,
  artifacts: buildArtifactCommands,
  editor: buildEditorCommands,
  application: buildApplicationCommands,
  utilities: buildUtilityCommands,
} satisfies Record<CommandPaletteDomain, CommandPaletteRegistry>;

export function assembleCommandPaletteModel(args: BuildCommandPaletteModelArgs): CommandEntry[] {
  const translate = args.t
    ? (key: string, options?: Record<string, unknown>) =>
        args.t?.(key, options) as unknown as string
    : (key: string) => identityTranslate(key);

  return COMMAND_PALETTE_DOMAIN_ORDER.flatMap(domain =>
    COMMAND_PALETTE_REGISTRIES[domain]({ args, translate })
  );
}
