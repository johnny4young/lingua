# Lingua CLI Usage

Slice 1 (RL-098). The CLI is a thin, headless surface over the same
shared utility adapters and capsule schema the desktop app uses. It
runs offline. It does not load Electron, React, or any renderer-only
code.

## Install / build

The CLI is not yet published to npm. For now, build it locally from
the repo:

```bash
git clone https://github.com/johnny4young/lingua
cd lingua
pnpm install                    # runs `prepare` → builds dist/cli/lingua.cjs
pnpm run build:cli              # explicit rebuild
```

The binary is `dist/cli/lingua.cjs`. The `prepare` script rebuilds
it whenever you `pnpm install` so a fresh `git pull` does not require
a manual rebuild.

To link the CLI globally on your machine for dev:

```bash
pnpm link --global              # exposes `lingua` on PATH
lingua --help
```

To uninstall:

```bash
pnpm uninstall --global lingua
```

## Commands

### `lingua utility <utility-id>`

Runs a single utility adapter against an input. Adapters are pure
functions extracted from the renderer in RL-099 Slice 1.

```bash
echo '{"a":1}' | lingua utility json-format
lingua utility json-format --input data.json --option indent=4
lingua utility base64-encode --input README.md
lingua utility base64-decode --input b64.txt
lingua utility url-parse --input url.txt
lingua utility regex-replace --input src.ts \
  --option pattern='\d+' --option flags=g --option replacement=N
lingua utility diff-text --input new.txt --option baseline="$(cat old.txt)"
```

Flags:

- `--input <file>` — read from `<file>` instead of stdin.
- `--option key=value` — pass adapter options. Repeated. The available
  keys for each adapter are listed by `lingua list utilities --json`.
- `--json` — emit `{ ok, value?, reason?, detail? }` on stdout
  instead of plain text. Stable across releases (RL-098 Slice 1
  fold F snapshot tests pin the shape).
- `--quiet` — suppress error stderr. Success stdout is preserved so
  pipelines stay byte-stable.

### `lingua capsule validate <file>`

Validates a Lingua run capsule (RunCapsuleV1) using the same
validator the desktop app's Settings → Account → Run Capsules
section calls. Exits 0 on success and prints a one-line summary;
exits 1 with the closed-enum reject reason on failure.

```bash
lingua capsule validate ./build-output/run.capsule.json
lingua capsule validate ./build-output/run.capsule.json --json
```

Closed-enum reject reasons:

- `file-not-found` — `<file>` does not exist (ENOENT).
- `read-failed` — read error (e.g. EACCES).
- `invalid-json` — not parseable JSON.
- `unsupported-version` — `version !== 1`.
- `oversized` — capsule > 4 MiB.
- `missing-required-field` — schema-required key missing.
- `invalid-field-type` — schema-typed key carries the wrong shape.

### `lingua list utilities`

Prints the adapter registry. Useful when discovering what's
available, especially in CI scripts.

```bash
lingua list utilities          # tab-separated id / kinds / options
lingua list utilities --json   # structured for tooling
```

### `lingua --version` / `lingua --help`

`--version` (or `-v`) prints the CLI version (bound at bundle time
from `package.json`). `--help` (or `-h`) prints the help text.

## Exit codes

CI scripts can depend on these numbers being stable across releases.
Adding new codes is allowed; renumbering existing ones is forbidden
(snapshot-tested in `tests/cli/parseArgs.test.ts`).

| Code | Name | Meaning |
|---|---|---|
| 0 | `ok` | Success. |
| 1 | `userInputError` | Bad CLI args, unknown utility id, missing file, malformed `--option`, schema-rejected input. |
| 2 | `runtimeError` | Adapter returned `{ ok: false, reason }`. |
| 3 | `unsupportedCapability` | Adapter declared a `binary` output kind (reserved for Slice 2+ adapters). |
| 4 | `internal` | Caught exception we did not classify. |

## Out of scope (Slice 2+)

- `lingua capsule replay` — depends on extracting the runner
  adapters out of the renderer.
- `lingua run <file>` — same dependency.
- `lingua lesson validate` — depends on RL-039 Slice B shipping.
- Standalone binaries (`pkg`, `nexe`) and Windows code-signing —
  Slice 3+.
- Shell completions (`lingua completion bash|zsh|fish`) — Slice 2
  follow-up.
- Localized CLI copy — Slice 2+ (English-only Slice 1, consistent
  with `electron-forge` / `electron-builder` precedent).
- TTY color codes / `--color=auto` — Slice 2+.

## CI integration tips

```bash
# Validate every capsule produced by a build pipeline
for capsule in build/*.capsule.json; do
  lingua capsule validate "$capsule" --quiet \
    || { echo "Invalid capsule: $capsule"; exit 1; }
done

# Format JSON ahead of a snapshot diff in CI
lingua utility json-format --input expected.json --option indent=2 \
  > expected.formatted.json
```
