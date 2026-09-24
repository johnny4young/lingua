---
title: Validate and replay Run Capsules
description: Check a RunCapsuleV1 safely, replay trusted single-source captures, and understand integrity and workspace boundaries.
order: 30
group: guides
keywords: [capsule, validate, replay, RunCapsuleV1, hash, comparison, workspace, trust]
---

Run Capsules preserve one source buffer, input, arguments, environment metadata, and recorded output. The CLI can validate that contract or replay its single source through a local runtime.

## From the app to the CLI

Run code in Lingua, then open **Settings → Account → Run capsules** and choose
**Save JSON for CLI**. Desktop uses a local Save dialog; Browser downloads the
same sanitized `RunCapsuleV1` JSON. The suggested filename is
`lingua-run.capsule.json`. You can also import the JSON in Lingua to preview it
without running it.

In a terminal opened in the saved file's folder, validate first:

```bash
lingua capsule validate "lingua-run.capsule.json" --json
```

Inspect the JSON source and use the separate replay command only if you trust
it. Replay executes code with your operating-system permissions:

```bash
lingua capsule replay "lingua-run.capsule.json" --json
```

The app offers separate Copy buttons for these commands; copying does not run
either one. Change the quoted path if you chose another filename or folder.

## Validate without executing

```bash
lingua capsule validate ./run.capsule.json
lingua capsule validate ./run.capsule.json --json
```

Validation checks the 4 MiB limit, JSON syntax, schema version, migrations, required fields, and field types. It never executes the stored source.

Use this form in an upload or build gate:

```bash
for capsule in build/*.capsule.json; do
  lingua capsule validate "$capsule" --quiet || exit 1
done
```

## Replay trusted source

```bash
lingua capsule replay ./run.capsule.json
lingua capsule replay ./run.capsule.json --timeout 60000 --json
```

Replay first verifies that `source.content` matches its recorded SHA-256 hash. It then executes the source and compares status, stdout, and stderr with the recorded result.

A successful command may still report `comparison.matches: false`. That is useful reproducibility evidence, not a runtime failure.

## Know the trust boundary

The content hash detects accidental inconsistency. It is **not a signature**: someone editing the file can replace the source and recompute its hash. Replay only Capsules from sources you trust because their code receives your current operating-system permissions.

Browser-preview Capsules are not replayable in a headless process, and missing runtimes exit with code 3 instead of silently changing execution mode.

## Capsule Workspace workaround

`CapsuleWorkspaceV1` can carry explicitly selected supplemental text files for read-only handoff in the app. The CLI does not reconstruct or replay that multi-file wrapper.

- If the nested Capsule is independently runnable, extract and replay that single source.
- If it depends on sibling files, use `lingua run <project-directory>` against the actual project.
