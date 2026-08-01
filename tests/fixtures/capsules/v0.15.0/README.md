# Lingua v0.15.0 Capsule compatibility fixture

`javascript-input-set.capsule.json` is an immutable golden artifact for the
Capsule contract shipped in Lingua `v0.15.0`.

Provenance:

- release tag: `v0.15.0`
- release commit: `91667f3d8acb202feb9795cb6ca64c92df8d6789`
- schema: `RunCapsuleV1`
- producer version stamped in the artifact: `0.15.0`
- source release timestamp: `2026-07-28T21:09:05.000Z`

The file was captured once by bundling `runCapsule.ts` and `redaction.ts`
directly from that tagged commit, calling its exported `buildRunCapsule` with
the fixed values visible in the artifact, passing the result through the tagged
`sanitizeRunCapsule`, and writing the same pretty JSON used by the product
exporter. Its SHA-256 is pinned in the integration test.

The fixture deliberately carries source, stdin, argv, a named input set, and
recorded output. The stable-compatibility tests load these bytes through the
current shared parser, renderer importer, CLI validator, CLI replay path, and
the web import surface. That makes future schema migrations prove an actual
old-release journey instead of only exercising a synthetic object assembled by
the current code.

Do not regenerate this file with current product code. When another stable
baseline is needed, add a sibling version directory and preserve this one.
