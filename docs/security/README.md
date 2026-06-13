# Security Review Packets

This directory stores dated security review packets: threat models, finding
matrices, remediation notes, and validation evidence for repo-level security
work. These files are historical analysis records. The current release gate
remains `docs/RELEASE_SECURITY.md`.

## Packets

| Date | Scope |
| ---- | ----- |
| [`2026-05-09`](./2026-05-09) | Full-repo Codex Security remediation packet covering filesystem IPC, licensing, update feeds, runtime assets, parser/resource caps, plugin discovery, and diagnostics. |

## References

Living policy references (not dated packets) that track current state:

| Doc | Scope |
| --- | ----- |
| [`filesystem-denylist.md`](./filesystem-denylist.md) | Renderer-facing filesystem path denylist (`BLOCKED_PATHS`): families, enforcement layers, and how to extend it. Source of truth: `src/main/ipc/permissions.ts`. |
| [`license-key-registry.json`](./license-key-registry.json) | RL-143 — every license-signing public key ever embedded, keyed by RFC 7638 thumbprint, with `issuedAt`/`status` and the rotation SLA the release gate enforces. Rotation runbook: `docs/RELEASE_SECURITY.md` § Licensing. |
