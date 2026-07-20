/**
 * implementation — CLI exit-code contract.
 *
 * Closed enum. CI scripts depend on these numbers being stable across
 * releases. Adding new codes is allowed; renumbering existing ones is
 * forbidden — the snapshot test in `tests/cli/parseArgs.test.ts`
 * pins the map.
 *
 * Per the implementation scope:
 *
 *   - `0` ok
 *   - `1` user input error (bad args, unknown id, missing file, bad shape)
 *   - `2` runtime error (adapter returned `{ ok: false }` mid-run)
 *   - `3` unsupported capability (e.g. binary outputKind in implementation)
 *   - `4` internal (caught exception we didn't classify)
 */

export const CLI_EXIT_CODES = {
  ok: 0,
  userInputError: 1,
  runtimeError: 2,
  unsupportedCapability: 3,
  internal: 4,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];
export type CliExitCodeName = keyof typeof CLI_EXIT_CODES;
