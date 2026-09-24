---
title: From a snippet to reproducible evidence
description: Run a local JavaScript example, recover from an error, and hand a reviewed Run Capsule to the CLI without conflating validation with execution.
order: 2
section: guide
---

This walkthrough uses a JavaScript scratchpad and needs no network request or
project setup. The editor, run, error, recovery, and **latest-run Capsule
export** work on the Free tier in the browser or desktop app. The browser
needs a first online load. For the CLI steps, install the separate CLI and
provide Node.js 24; [start with the CLI guide](/cli). Go, Rust, and the local
MCP server are desktop-specific, not part of this browser demo. Browser file
access uses user-granted File System Access handles where supported; desktop
uses its native filesystem bridge and watcher.

## 1. Run and inspect output

Open [Lingua in your browser](https://app.linguacode.dev) or the desktop app.
Use a JavaScript tab in the default Worker runtime. Replace the editor contents
with:

```js
const x = 1 + 2; console.log(x);
```

Choose **Run** (or press `Cmd/Ctrl+Enter`). The console should show `3`.

## 2. Cause an error, then recover

Replace the source with this deliberate failure and run again:

```js
throw new Error('demo failure');
```

Inspect the error in the console. Replace it with the first snippet and run
again; the new result should be `3`. This is a recovery test, not a claim that
all errors can be fixed automatically. **Stop** cancels a current run; it does
not silently replay the previous source.

## 3. Save one reviewed run

Open **Settings → Account → Run capsules → Save JSON for CLI**. The browser
downloads `lingua-run.capsule.json`; desktop opens a local Save dialog. This
exports the latest run in Free. Expanded history browsing and opt-in source
snapshots are paid features; they are not required here.

Open the JSON and check `source.content`, `result.stdout`, and the redacted
metadata **before sharing**. Export includes your source code and may include
input/output; it is not an anonymous telemetry event. Importing the file back
into Lingua opens a preview without executing it.

## 4. Validate, then explicitly replay trusted code

Open a terminal in the file's folder. Validation checks structure but **does
not execute the source**:

```bash
lingua capsule validate "lingua-run.capsule.json" --json
```

Only after inspecting and trusting the source, use the separate command:

```bash
lingua capsule replay "lingua-run.capsule.json" --json
```

Replay executes with your OS permissions. Its comparison reports whether the
new status and output match the recorded run; it does not promise identical
results for network requests, clock time, dependencies, or different machines.
See the [Capsule CLI guide](/cli/capsules) for the hash and workspace limits.

## Repeat the CLI check without opening the app

The repository includes a fixed
[`RunCapsuleV1` example](https://github.com/johnny4young/lingua/blob/main/docs/examples/deterministic-run.capsule.json).
From a checkout of the repository, run:

```bash
lingua capsule validate docs/examples/deterministic-run.capsule.json --json
lingua capsule replay docs/examples/deterministic-run.capsule.json --json
```

That example records `3\n`; replay's comparison should report
`matches: true` with Node.js 24. The content hash catches inconsistency, not
malice: a modified file can carry a recomputed hash. Never replay an untrusted
Capsule.

**Agent boundary:** Desktop's local MCP tools are read-only and do not execute
code. A shell-capable agent using the separate CLI has a different authority;
validation is inert, while replay is an explicit execution decision. Read the
[agent integration guide](/cli/ai-agents) before giving either to an agent.
