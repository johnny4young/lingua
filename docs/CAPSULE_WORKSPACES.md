# Capsule Workspaces

A Capsule Workspace is Lingua's bounded, no-backend format for sharing one run
with a small set of related text files. It is intended for code review,
reproduction context, and handoff when a single-source Run Capsule is too small
but a full project bundle is unnecessary.

## Relationship to Run Capsules

`RunCapsuleV1` remains the stable execution artifact. A
`CapsuleWorkspaceV1` wraps one sanitized `RunCapsuleV1` and adds explicitly
selected supplemental text files:

```text
CapsuleWorkspaceV1
├── capsule: RunCapsuleV1
├── files[]: portable path + language + source + SHA-256
└── privacy: explicit-review metadata
```

The wrapper is additive. It does not change the Run Capsule schema, CLI replay
contract, existing share links, or stable-release migration chain.

## Create and inspect

1. Run code so it appears in **Run capsules**.
2. Keep the related text files open as editor tabs.
3. Open **Run capsules**, choose **Create Capsule Workspace** on a row, and
   select the supplemental tabs.
4. Inspect the exact source preview. Possible high-confidence secret patterns
   are flagged but never silently changed.
5. Confirm that you reviewed the payload, then copy or download the JSON.

Import the JSON through the existing Capsule import overlay. The primary run is
shown in the normal Source, Result, and Environment tabs. A Files tab lists each
supplemental file and lets the recipient open one inert editor tab at a time.
Opening never runs code.

## Privacy and trust boundary

- Export is local-only. Lingua does not upload the artifact or require an
  account/backend.
- Only open code tabs selected by the user can be attached. Lingua does not
  crawl the project or filesystem.
- Capability-relative paths are preferred; visible tab names are the fallback.
  Absolute paths, drive paths, traversal, backslashes, control characters, and
  case-insensitive duplicate paths are rejected.
- Filesystem capability identifiers, project roots, and host paths are never
  serialized.
- Secret detection is advisory. Source is preserved exactly for
  reproducibility, so the review confirmation is mandatory. Import reruns the
  current detector instead of trusting the count stored by the sender.
- The read-only importer recomputes each supplemental file's SHA-256 locally.
  The Files tab distinguishes checking, verified, mismatch, and not verified
  (for example, when Web Crypto is unavailable). Replacing the import cannot
  reuse an earlier workspace's verification result. Opening a file remains an
  explicit, inert action even when verification fails.
- Hashes cover the exact UTF-8 encoding of the JSON string value using
  `TextEncoder`, matching the exporter. BOMs, newline sequences and Unicode
  normalization forms are preserved; unpaired UTF-16 surrogates follow
  `TextEncoder` replacement semantics. JSON escape spelling is not hashed.
- Hashes are integrity metadata, not signatures. Anyone who can edit the JSON
  can edit a file and recompute its hash. A verified file does not authenticate
  its author, establish safe execution, validate the primary Run Capsule's
  source hash, or check dependency availability. Treat workspaces from untrusted
  sources as untrusted code.
- Missing or malformed hashes remain invalid under the existing v1 schema and
  reject the workspace before preview; integrity results are transient and are
  not added to the artifact or persisted. No dependencies are downloaded and no
  code is executed to perform verification.

## Limits

| Boundary                    |              Limit |
| --------------------------- | -----------------: |
| Supplemental files          |                 24 |
| One supplemental file       |      256 KiB UTF-8 |
| All supplemental source     |        2 MiB UTF-8 |
| Complete workspace artifact |        6 MiB UTF-8 |
| Portable path               |    240 UTF-8 bytes |
| Nested Run Capsule          | Existing 4 MiB cap |

The limits are enforced by the shared builder and parser, not only by the UI.
Malformed metadata, invalid paths, duplicate paths, oversized content, and an
invalid nested Capsule fail closed before the viewer renders them.

## CLI boundary

The CLI continues to validate and replay `RunCapsuleV1` files only. It does not
replay Capsule Workspaces or resolve supplemental imports. Use the app to
inspect the wrapper, or extract the nested `capsule` object when the single
source is independently replayable. Use `lingua run <project-directory>` when
execution depends on a real project tree and installed dependencies.
