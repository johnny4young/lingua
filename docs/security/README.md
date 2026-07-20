# Security references

This directory contains current, maintained security references. Release
evidence and operator gates live in [`../RELEASE_SECURITY.md`](../RELEASE_SECURITY.md);
completed review packets and private finding matrices are not published here.

| Document | Scope |
| --- | --- |
| [`filesystem-denylist.md`](./filesystem-denylist.md) | Renderer-facing blocked-path families, enforcement layers, and extension guidance. Source of truth: `src/main/ipc/permissions.ts`. |
| [`license-key-registry.json`](./license-key-registry.json) | Embedded license-signing public keys, RFC 7638 thumbprints, status metadata, and rotation evidence consumed by the release gate. |
