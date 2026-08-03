# Project test runner architecture decision

**Status:** Accepted

**Date:** 2026-08-01

## Context

Lingua can execute one editor buffer, but a real project often validates behavior through its existing test suite. Calling a package script supplied by the renderer would be flexible, but it would also turn the preload bridge into an arbitrary command launcher. Browser builds cannot start local processes at all.

## Decision

The test runner is a desktop-native, capability-scoped feature. The renderer sends only:

- the opaque `rootId` for the open project;
- one closed runner id: `vitest`, `jest`, `pytest`, `go`, or `cargo`;
- a bounded `runId` used for output and cancellation.

Main resolves `rootId` through the existing filesystem capability registry, re-detects the requested runner immediately before execution, and owns every executable and argument. No absolute renderer path, executable, argument, package script, or environment map crosses IPC.

| Runner | Root evidence                                                           | Fixed command shown in the UI     |
| ------ | ----------------------------------------------------------------------- | --------------------------------- |
| Vitest | local dependency, script, or `vitest.config.*`                          | `vitest run --no-color`           |
| Jest   | local dependency, script, `package.json#jest`, or `jest.config.*`       | `jest --runInBand --colors=false` |
| Pytest | config/dependency marker or conventional `test_*.py` / `*_test.py` file | `python -m pytest -q --color=no`  |
| Go     | `go.mod`                                                                | `go test ./...`                   |
| Cargo  | `Cargo.toml`                                                            | `cargo test --color never`        |

Detection reports every matching runner, including configured runners whose dependency or toolchain is missing. JavaScript runners use their project-local entry point under `node_modules`; Python prefers `.venv`/`venv`; host tools are accepted only from absolute `PATH` entries.

## Security and lifecycle

- `child_process.spawn` runs with `shell: false` and a fixed argument vector.
- The child inherits only the existing native-toolchain allowlist plus runner-owned color/CI flags; host secrets and dynamic-loader injection variables are not forwarded.
- Only one test process may run per approved project root. Output is streamed back by `runId`, retained with a per-stream 256 KiB cap, and marked when truncated.
- Main owns a five-minute timeout. Stop and timeout terminate the process tree with SIGTERM and escalate to SIGKILL.
- Renderer destruction aborts its in-flight run even when detection has not finished yet, and Electron's quit lifecycle disposes any remaining runs.
- Tests and their dependencies remain arbitrary local code. The first Run therefore uses the same persisted native-execution acknowledgement as Go, Rust, and system Ruby, with project-specific warning copy.
- The web adapter deliberately omits the bridge. The UI explains the desktop requirement rather than simulating execution.

## Consequences

The feature covers the common zero-configuration project path without exposing a general shell. Custom commands, filters, watch mode, coverage flags, monorepo traversal outside the approved root, and remote execution are intentionally out of scope. Adding a runner requires extending the closed shared contract, detection evidence, fixed argv, environment policy, UI copy, and tests together.
