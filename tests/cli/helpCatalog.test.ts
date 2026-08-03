import { describe, expect, it } from 'vitest';
import { CLI_TOP_LEVEL_COMMANDS } from '../../src/cli/commandModel';
import { CLI_HELP_CATALOG, renderCliHelpText } from '../../src/cli/helpCatalog';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';

describe('CLI help catalog', () => {
  it('covers every top-level command exactly once or as explicit subcommands', () => {
    expect([...new Set(CLI_HELP_CATALOG.commands.map(command => command.topLevel))].sort()).toEqual(
      [...CLI_TOP_LEVEL_COMMANDS].sort()
    );
    expect(new Set(CLI_HELP_CATALOG.commands.map(command => command.id)).size).toBe(
      CLI_HELP_CATALOG.commands.length
    );
  });

  it('references only declared flags with reciprocal command ownership', () => {
    const flagsById = new Map(CLI_HELP_CATALOG.flags.map(flag => [flag.id, flag]));
    for (const command of CLI_HELP_CATALOG.commands) {
      for (const flagId of command.flags) {
        const flag = flagsById.get(flagId);
        expect(flag, `${command.id} references missing flag ${flagId}`).toBeDefined();
        expect(flag?.commands).toContain(command.id);
      }
    }
    const commandsById = new Map(CLI_HELP_CATALOG.commands.map(command => [command.id, command]));
    for (const flag of CLI_HELP_CATALOG.flags) {
      for (const commandId of flag.commands) {
        const command = commandsById.get(commandId);
        expect(command, `${flag.id} references missing command ${commandId}`).toBeDefined();
        expect(command?.flags).toContain(flag.id);
      }
    }
  });

  it('pins the stable exit-code contract', () => {
    expect(CLI_HELP_CATALOG.exitCodes.map(({ name, code }) => [name, code])).toEqual(
      Object.entries(CLI_EXIT_CODES)
    );
  });

  it('renders every invocation, flag, and representative example', () => {
    const help = renderCliHelpText();
    for (const command of CLI_HELP_CATALOG.commands) {
      expect(help).toContain(command.invocation);
      expect(help).toContain(command.examples[0]?.command);
    }
    for (const flag of CLI_HELP_CATALOG.flags) expect(help).toContain(flag.syntax);
  });
});
