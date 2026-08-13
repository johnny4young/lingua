// SPDX-License-Identifier: MIT
/** Closed CLI vocabularies used by parsing, presentation, and completion guards. */

export const CLI_COLOR_MODES = ['auto', 'always', 'never'] as const;
export type CliColorMode = (typeof CLI_COLOR_MODES)[number];

export const CLI_COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CliCompletionShell = (typeof CLI_COMPLETION_SHELLS)[number];
export const CLI_COMPLETION_TARGETS = [...CLI_COMPLETION_SHELLS, 'install'] as const;

export const CLI_TOP_LEVEL_COMMANDS = ['utility', 'run', 'capsule', 'list', 'completion'] as const;

export function isCliColorMode(value: string): value is CliColorMode {
  return (CLI_COLOR_MODES as readonly string[]).includes(value);
}

export function isCliCompletionShell(value: string): value is CliCompletionShell {
  return (CLI_COMPLETION_SHELLS as readonly string[]).includes(value);
}
