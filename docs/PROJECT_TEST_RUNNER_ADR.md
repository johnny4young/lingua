# Project test runner architecture decision

**Status:** Accepted

**Date:** 2026-08-01

## Context

Lingua can execute one editor buffer, but a real project often validates behavior through its existing test suite. Calling a package script supplied by the renderer would be flexible, but it would also turn the preload bridge into an arbitrary command launcher. Browser builds cannot start local processes at all.

## Decision

The test runner is a desktop-native, capability-scoped feature. The renderer sends only:

- the opaque `rootId` for the open project;
- one closed runner id: `vitest`, `jest`, `pytest`, `go`, or `cargo`;
- a bounded `runId` used for output and cancellation;
- an optional scope: the whole suite, one project-relative file, or one test by its suite path (see the amendment below).

Main resolves `rootId` through the existing filesystem capability registry, re-detects the requested runner immediately before execution, and owns every executable and argument. No absolute renderer path, executable, argument, package script, or environment map crosses IPC.

| Runner | Root evidence                                                           | Fixed command                     |
| ------ | ----------------------------------------------------------------------- | --------------------------------- |
| Vitest | local dependency, script, or `vitest.config.*`                          | `vitest run --no-color`           |
| Jest   | local dependency, script, `package.json#jest`, or `jest.config.*`       | `jest --runInBand --colors=false` |
| Pytest | config/dependency marker or conventional `test_*.py` / `*_test.py` file | `python -m pytest -q --color=no`  |
| Go     | `go.mod`                                                                | `go test ./...`                   |
| Cargo  | `Cargo.toml`                                                            | `cargo test --color never`        |

Detection reports every matching runner, including configured runners whose dependency or toolchain is missing. The empty state keeps an explicit Detect again action so a newly added root configuration can be found without reopening the project. It never starts a test run. JavaScript runners use their project-local entry point under `node_modules`; Python prefers `.venv`/`venv`; host tools are accepted only from absolute `PATH` entries.

## Security and lifecycle

- `child_process.spawn` runs with `shell: false` and a fixed argument vector.
- The child inherits only the existing native-toolchain allowlist plus runner-owned color/CI flags; host secrets and dynamic-loader injection variables are not forwarded.
- Only one test process may run per approved project root. Output is streamed back by `runId`, retained with a per-stream 256 KiB cap, and marked when truncated.
- Main owns a five-minute timeout. Stop and timeout terminate the process tree with SIGTERM and escalate to SIGKILL.
- Renderer destruction aborts its in-flight run even when detection has not finished yet, and Electron's quit lifecycle disposes any remaining runs.
- Tests and their dependencies remain arbitrary local code. The first Run therefore uses the same persisted native-execution acknowledgement as Go, Rust, and system Ruby, with project-specific warning copy.
- The web adapter deliberately omits the bridge, so the web build hides the Tests tab and its entry points rather than simulating execution.

## Amendment: per-test results and scoped runs (2026-10-26)

The Tests tab lists each test and can run one file or one test, so two of the original exclusions are lifted, with the same ownership rules:

- **Structured results.** Main adds each runner's own reporter and parses it into project-relative cases (`file`, suite path, status, duration, failing file and line, a capped message); no absolute path reaches the renderer, and a path outside the root is dropped. Vitest and Jest write their JSON report, pytest its JUnit XML (`junit_family=xunit1`), each to a temporary folder main creates and deletes after the run. Go streams `go test -json`, which main turns back into plain `go test` text for the raw output. Cargo has no stable machine format, so main reads libtest's text and passes `--no-fail-fast`. The raw transcript stays available.
- **Scoped runs.** The renderer may send a scope: the whole suite, one project-relative file (a Go package directory), or one test by its suite path. Main rejects absolute paths, `..`, segments that start with `-` or `@` (an option or a pytest argument file), control characters and targets that do not exist, then builds the arguments itself: an exact Vitest specification or `--runTestsByPath` for Jest, a pytest node id, `./dir` and an anchored `-run` per subtest level for Go, and `--lib`, `--test <name>`, `--bin <name>` or `--bins` (for `src/main.rs`) plus `--exact` for Cargo. Names reach Vitest, Jest and Go as escaped, anchored patterns and pytest and Cargo as literal arguments, never through a shell; a Cargo name must be a Rust path, since libtest would read anything else after `--` as an option. Every path a report returns is checked the same way, and a case outside the root is dropped. Rust doc tests are listed but cannot be run on their own.

Vitest scoped runs use the project-local Node API to discover configured test
specifications and compare their normalized absolute module paths before running
any tests. Its CLI file arguments are substring filters, including for absolute
paths. The child initializes reporters without running tests, keeps project
configuration and sequencers, applies the anchored name pattern for a single
test, and closes Vitest in a finally block. A file excluded by the project's
configuration fails explicitly. This requires the specification API available
in Vitest 3 and later; older runners fail rather than falling back to a broader
CLI run. Whole-suite runs retain the local CLI entrypoint.

A scoped file or build failure can have no test name, or name a dependency
rather than the requested target. The renderer retains those diagnostics as
current failures and opens the runner output. It keeps earlier results in the
requested scope as explicitly not run history and excludes them from current
outcome counts; results outside the scope stay as they were, and
unrelated incoming passes cannot become results of the selected test. A later
reported result replaces its own history and clears the file's earlier build
diagnostic. These history markers are transient renderer state, not runner
outcomes or persisted data.

## Consequences

The feature covers the common zero-configuration project path without exposing a general shell. Custom commands, free-form filters, watch mode, coverage flags, monorepo traversal outside the approved root, and remote execution remain out of scope. Adding a runner requires extending the closed shared contract, detection evidence, fixed argv, environment policy, UI copy, and tests together.
