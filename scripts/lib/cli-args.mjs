/**
 * pnpm forwards the `--` argument separator into a script's argv,
 * whereas npm strips it before the script runs. Node's
 * `util.parseArgs` treats a leading `--` as the positional terminator
 * and then rejects the following real flags as unexpected positionals
 * (`ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`). Strip standalone `--`
 * tokens so both `pnpm run x -- --flag` and `npm run x -- --flag`
 * reach `parseArgs` as `--flag`.
 *
 * Only standalone `--` tokens are removed; flag values and `--name`
 * style flags are left untouched. These CLI scripts take no positional
 * arguments, so dropping every `--` separator is safe.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function stripArgSeparator(argv) {
  return argv.filter((arg) => arg !== '--');
}
