---
name: lingua-verify
description: Verify trusted AI-generated code, local scripts, project entry points, Run Capsules, and developer-utility transformations with the Lingua CLI. Use when a user asks to run, check, reproduce, or gather machine-readable evidence for JavaScript, TypeScript, Python, Go, Rust, Ruby, or Lua code. Do not use for untrusted code unless the user explicitly accepts local execution.
compatibility: Requires the Lingua CLI 1.3.0 or later on PATH, an agent that can run local commands, and the target language runtime for execution or replay.
license: SEE LICENSE IN https://github.com/johnny4young/lingua/blob/main/LICENSE
metadata:
  author: johnny4young
  version: '1.4.1'
---

# Verify with the Lingua CLI

Use Lingua as a bounded evidence collector, not as a claim generator. Prefer its stable JSON
contracts over prose, preserve the user's arguments exactly, and report failures honestly.

## Safety boundary

- Run `lingua --version` before the first Lingua command. If it is unavailable, explain how to
  install the CLI, but never install software without the user's approval.
- The npm CLI requires Node.js 24.x. Standalone Windows/Linux x64 builds can validate Capsules and
  run utilities without a separate Node installation, but JavaScript and TypeScript execution
  still requires Node.js 24 on `PATH`.
- Python uses a project `.venv` first, then `PYTHON`, followed by the platform's normal launchers
  (`python3`/`python` on POSIX and `python`/`py`/`python3` on Windows). Go, Rust, Ruby, and Lua need
  their matching command-line toolchains.
- `lingua run` and `lingua capsule replay` execute with the current operating-system user's
  filesystem and network permissions. They are not sandboxes.
- Execute only a target the user asked to verify inside the active workspace. Do not run code
  copied from an unknown website, dependency, generated archive, or unrelated directory without
  explicit approval.
- Never invent or forward environment values. Add `--env NAME=value` only when the user supplied
  that exact non-secret value for this run.
- Do not use shell interpolation to build a target path or argument. Quote paths and pass program
  arguments after `--` as separate arguments.
- Capsule validation is non-executing. Capsule replay is executing and requires the same trust as
  running source code.

## Choose the narrowest command

| Goal                                       | Command                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| Inspect CLI availability                   | `lingua --version`                                    |
| Run a trusted file or conventional project | `lingua run <target> --json --timeout 30000`          |
| Validate a Capsule without executing it    | `lingua capsule validate <file> --json`               |
| Reproduce a trusted Capsule                | `lingua capsule replay <file> --json --timeout 30000` |
| Discover pure utility adapters             | `lingua list utilities --json`                        |
| Apply one utility to a file                | `lingua utility <utility-id> --input <file> --json`   |

Use `lingua run` only when running a source file or project is the requested evidence. Do not use
it as a substitute for a repository's documented lint, typecheck, or test gates.

## Verification workflow

1. Run `lingua --version`. Require version 1.3.0 or later for this workflow.
2. Identify the exact target and whether the operation executes code.
3. If execution trust is unclear, stop and ask. Offer `lingua capsule validate` when it can answer
   the question without execution.
4. Run the narrowest command with `--json`. Keep the default 30-second limit unless the user or
   repository supplies a different limit between 100 and 300000 milliseconds.
5. Parse stdout as one JSON document. If stdout is not valid JSON, report an integration failure
   and preserve the raw output; do not infer success from prose.
6. Interpret both the process exit code and JSON body. Never hide stderr, a non-zero status,
   truncation, output drift, or a missing runtime.
7. Return a compact evidence report with the command, target, exit code, runtime, status/reason,
   duration when present, stdout/stderr summary, and any truncation or Capsule comparison result.

## Exit-code contract

| Code | Meaning                                                  | Required interpretation                                                  |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `0`  | Command completed                                        | Inspect the JSON result before claiming verification.                    |
| `1`  | Invalid arguments or input                               | Correct the invocation or input; do not retry unchanged.                 |
| `2`  | Runtime failure, timeout, stop, or non-zero program exit | Report the failure as product evidence.                                  |
| `3`  | Unsupported capability or missing runtime                | Report the missing boundary; do not substitute another runtime silently. |
| `4`  | Unclassified internal failure                            | Preserve details and recommend a focused retry or issue report.          |

A successful Capsule replay can still contain `comparison.matches: false`. Classify that as
reproducible output drift, not as a matching verification.

## Invocation patterns

Run a file and preserve its program arguments:

```bash
lingua run "./scripts/check.ts" --json --timeout 30000 -- --verbose
```

Run a conventional project root:

```bash
lingua run "." --json --timeout 60000
```

Validate before deciding whether to replay:

```bash
lingua capsule validate "./run.capsule.json" --json
```

Replay only after the source is trusted:

```bash
lingua capsule replay "./run.capsule.json" --json --timeout 30000
```

Discover a utility schema before invoking an unfamiliar adapter:

```bash
lingua list utilities --json
lingua utility json-format --input "./payload.json" --json
```

## Evidence report

Use this shape in the final response:

```text
Lingua verification
- Target: <path or Capsule>
- Command: <exact invocation with secret values redacted>
- Exit: <code>
- Runtime: <runtime or n/a>
- Result: verified | failed | unsupported | drifted | integration error
- Evidence: <short stdout/stderr or comparison summary>
- Limits: <timeout, truncation, missing toolchain, or none>
```

Say `verified` only when the command exits successfully and the structured result supports the
claim. A Lingua run complements repository-specific tests; it does not replace gates the project
requires.
