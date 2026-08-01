# Lingua CLI Usage

The CLI is a thin, headless surface over the same
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
functions extracted from the renderer into shared modules.

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
  instead of plain text. Stable across releases; snapshot tests pin the shape.
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

### `lingua capsule replay <file>`

Validates the Capsule, verifies that `source.content` still matches its
recorded SHA-256 hash, and then executes the recorded source with its saved
stdin and argv. The plain-text mode forwards the new stdout/stderr and reports
whether status, stdout, and stderr match the recorded run. JSON mode emits one
stable envelope with the recorded status, the fresh run, and the comparison:

```bash
lingua capsule replay ./build-output/run.capsule.json
lingua capsule replay ./build-output/run.capsule.json --json
lingua capsule replay ./build-output/run.capsule.json --timeout 60000
```

Replay is intentionally fail-closed:

- Tampered source (`content-hash-mismatch`) is never executed.
- Browser-preview Capsules are rejected because the headless CLI has no DOM.
- JavaScript and TypeScript Capsules recorded in `worker` or `node` mode are
  replayable; `deno` and `bun` modes are rejected rather than silently
  substituting Node.
- A missing host runtime exits with code 3 instead of pretending the replay
  completed.
- A successful replay may still report `comparison.matches: false`; output
  drift is evidence, not a runtime failure. Scripts can inspect the comparison
  object when exact reproducibility is required.

RunCapsuleV1 stores one source buffer, stdin, and argv. It does not carry a
project root or sibling files, so relative imports and project-only dependencies
are outside this replay boundary. Use `lingua run <project-directory>` when the
project itself is available on disk.

The content hash is an internal consistency check, not an authenticity
signature: anyone who can edit a Capsule can also replace its source and
recompute the hash. Replay executes the source as a local child process with the
current user's operating-system permissions, even when the recorded mode was a
browser Worker. Only replay Capsules from sources you trust.

### `lingua run <file-or-directory>`

Executes a source file or a conventional project root through installed host
toolchains. Commands are spawned as argument vectors without a shell. Supported
file types are JavaScript, TypeScript (Node type stripping), Python, Go, Rust,
Ruby, and Lua:

```bash
lingua run ./scripts/check.ts -- --verbose
lingua run ./analysis.py --stdin fixtures/input.txt
lingua run ./hello.rs --timeout 60000 --json
lingua run ./my-project --env MODE=development
```

Project-root detection is explicit and ordered:

1. `package.json` with `scripts.start`, then `scripts.dev`, then a valid `main`.
2. `go.mod` → `go run .`.
3. `Cargo.toml` → `cargo run --quiet --`.
4. A conventional entry such as `main.py`, `explore.py`, `index.js`, or
   `src/index.ts`.

Framework-specific projects should pass their executable source file or invoke
their framework launcher directly when starting that source alone would not be
meaningful.

Execution flags:

- `--stdin <file>` — forward the file as program stdin. Without it, piped stdin
  is forwarded; an interactive TTY sends EOF instead of hanging.
- `--timeout <ms>` — parent-owned wall-clock limit from 100 to 300000 ms;
  defaults to 30000 ms. Timeout and Ctrl+C terminate the subprocess tree.
- `--env NAME=value` — repeatable explicit environment value. Arbitrary parent
  environment variables are not inherited; only audited toolchain/location
  keys are copied. Dynamic-loader injection keys and `NODE_OPTIONS` are blocked.
- `--` — every remaining token is forwarded to the program unchanged.
- `--json` — emit one `{ ok, run }` envelope instead of raw output.
- `--quiet` — suppress Lingua diagnostics while preserving program output.

Plain mode streams stdout and stderr while the program is running, so servers
and long-running projects expose progress immediately. Each stream is bounded
to a 1 MiB budget per invocation, including reserved space for an explicit
truncation marker. JSON mode buffers the same bounded values so stdout remains
exactly one parseable document.

`lingua run` is an execution tool, not an OS sandbox. Shell-free argument-vector
spawns, the environment allowlist, output budgets, and process-tree timeouts
reduce injection and resource hazards, but the target still has the current
user's filesystem and network permissions. Run only code you trust or place the
CLI inside your own container or sandbox.

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

| Code | Name                    | Meaning                                                                                      |
| ---- | ----------------------- | -------------------------------------------------------------------------------------------- |
| 0    | `ok`                    | Success.                                                                                     |
| 1    | `userInputError`        | Bad CLI args, unknown utility id, missing file, malformed `--option`, schema-rejected input. |
| 2    | `runtimeError`          | Adapter/runtime failure, non-zero program exit, timeout, or stopped execution.               |
| 3    | `unsupportedCapability` | Unsupported source/runtime mode, binary utility output, or required host runtime missing.    |
| 4    | `internal`              | Caught exception we did not classify.                                                        |

## Out of scope

- `lingua lesson validate` — lesson validation is not exposed through the CLI.
- Standalone binaries (`pkg`, `nexe`) and Windows code-signing —
  planned follow-up work.
- Shell completions (`lingua completion bash|zsh|fish`) — planned follow-up.
- Localized CLI copy — the CLI currently ships English-only copy, consistent
  with the repository's `electron-forge` and `electron-builder` tooling.
- TTY color codes / `--color=auto` — planned follow-up.
- Multi-file Capsule replay — the v1 Capsule schema intentionally stores one
  source buffer, not a project archive.

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
