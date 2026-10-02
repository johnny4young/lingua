# Current-file Capsule regression cases

Unreleased/source-build functionality. Feature-detect `verify-suite` and `--target`
in `lingua --help`; the published CLI 1.5.1 does not provide these commands.

```sh
lingua capsule verify baseline.capsule.json --target src/hello.js --json
lingua capsule verify-suite regression.lingua-suite.json --root . --timeout 30000 --json
```

Without `--target`, verify still executes captured source. With it, the CLI validates
and hashes the untouched baseline, then reads the current saved target file and runs
its bytes exactly like captured source: the baseline runtime mode, working directory,
stdin and argv. Only the source differs. It compares status, stdout and
stderr exactly. No whitespace normalization or automatic expectation update occurs.
Unsaved editor buffers are previews, not the bytes the CLI executes.

## Suite v1

A suite is an independent JSON document, not a modified Capsule:

```json
{
  "kind": "lingua-regression-suite",
  "suiteVersion": 1,
  "cases": [
    {
      "id": "hello-output",
      "name": "Hello output remains stable",
      "target": "src/hello.js",
      "baseline": { "version": 1, "...": "a complete valid RunCapsuleV1, not this placeholder" }
    }
  ]
}
```

The baseline must be a complete Capsule; the placeholder above is not a runnable
example. Expectations, argv and stdin exist only inside that baseline. Case IDs are
unique ASCII alphanumeric/hyphen/underscore identifiers up to 64 characters; names
are nonempty and at most 200 characters. Unknown suite/case fields are rejected.

Limits: 20 nonempty cases, 4 MiB UTF-8 per artifact, serial execution, the CLI timeout
per case (default 30 seconds) and a five-minute total budget. Targets are portable
relative paths. Absolute paths, traversal, escaping symlinks, non-files and source
extensions incompatible with the baseline are refused. `--root` defaults to cwd;
standalone `--target` is always relative to cwd. All baseline hashes and targets are
preflighted before any case executes; target authorization is rechecked per case.

JSON reports each case, comparison, recorded/actual runtime and a summary of passed,
failed, inconclusive and skipped cases. Only exit 0 with `ok: true`, `verdict: pass`
and every case passing is successful. Any drifted case makes the suite `fail` and
exit 5, even when other cases are inconclusive; otherwise incomplete or budget-skipped
cases exit 6. Existing input/runtime/capability/internal errors retain codes 1–4.
Program timeouts remain runtime errors with an inconclusive verdict; a timeout the
suite budget imposed reports `suite-budget-exhausted` and exits 6. Process-tree
termination and cleanup use the existing bounded runner, including its kill grace.

## Prepare and inspect in the app

The Capsules browser retains its existing Execution History entitlement. Select
**Prepare regression case**, choose an open same-language file in the current
project explicitly, review its current buffer, the captured baseline and possible
secrets, then export. One case becomes one suite; assemble multiple cases by editing
the versioned JSON without inventing another oracle. The original baseline hash is
preserved, not rewritten to fit current source. Incomplete baselines cannot export
as verification cases. The new command is also available in the CLI handoff alongside
validate and legacy replay; copying a command never executes it.

**Inspect a suite without execution** parses and previews a selected file. Importing,
opening a JSON artifact or preparing/exporting it never runs its code. Only an explicit
CLI invocation executes. No AI-generated cases, arbitrary hooks, installers, read-only
MCP execution, expectation updates or non-JSON report formats are added.

## Trust boundary

This is regression evidence, not a sandbox or a hermetic build. Code runs with the
current OS user's filesystem and network access and can import other files. Root
containment constrains target selection, not code effects. Runtime differences may
produce honest drift; a pass does not certify security or engine equivalence.
