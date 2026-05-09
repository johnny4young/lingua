# Threat Model - Security Review 2026-05-09

## Assets

| Asset | Why it matters |
| ----- | -------------- |
| Local filesystem contents | Desktop users can open projects that may contain private code, credentials, and documents. |
| License tokens and device bindings | Tokens unlock paid features and identify licensed devices. |
| Runtime execution surfaces | JavaScript, TypeScript, Python, Go, Rust, formatters, and previews process user-provided code or text. |
| Update feed and release artifacts | Desktop update metadata decides what binaries users are offered. |
| Plugin manifests | Local plugin discovery reads files that can be user-controlled. |
| Telemetry and crash reports | Diagnostic payloads must not leak code, paths, env values, or license tokens. |

## Trust Boundaries

| Boundary | Trusted side | Untrusted or less-trusted side | Review focus |
| -------- | ------------ | ------------------------------ | ------------ |
| Renderer -> preload -> main IPC | Main process capability checks | Renderer state, saved recent files, deep links, web adapter | Capabilities must be least-privilege and replay-resistant. |
| Main process -> local filesystem | User-approved roots/files | Renderer-provided root ids and relative paths | No raw absolute path reopening without prior approval. |
| Browser/web runtime -> third-party network | Same-origin app assets | CDN/runtime asset substitution | Runtime assets should be pinned and same-origin where possible. |
| License-server HTTP API -> D1 database | Server handlers and DB constraints | Client emails, device ids, old tokens | Avoid enumeration, races, and stale token replay. |
| Update-server HTTP API -> GitHub Releases | Release metadata contract | GitHub asset names and platform/version params | Do not select unrelated artifacts by loose substring matching. |
| Parser/formatter/runners -> user input | Bounded process and worker code | Arbitrary source text, HTML, Markdown, formatter output | Enforce size, timeout, and output caps on both success and failure paths. |
| Crash/error report builder -> diagnostics | Redaction pipeline | Raw `Error.message`, stack traces, URL/path-like values | Redact before truncation and before copy/export. |

## Attacker Profiles

- Malicious local project: convinces a user to open a folder or file, then relies
  on restored session state or deep links to expand filesystem access.
- Malicious web/runtime input: supplies large or deeply nested Markdown/HTML,
  code, formatter output, or runner payloads to exhaust memory/CPU.
- License abuse client: uses trial, education, activation, or status endpoints
  to enumerate accounts, race device caps, or replay older signed tokens.
- Release artifact confusion: publishes or exposes misleading asset names so an
  update feed selects the wrong Darwin ZIP.
- Local plugin abuse: places many plugin directories or oversized manifests in
  discovery paths to trigger slow scans or large reads.
- Diagnostic leak path: causes errors containing tokens, query params, file
  paths, or bearer values and then relies on raw reporting surfaces.

## Security Properties Used For Remediation

### Filesystem IPC

- A directory grant must not imply an arbitrary future grant outside that root.
- A single-file open/save grant must not grant the file's parent directory.
- Reopen flows must be backed by a remembered approval, not only a saved path in
  renderer-controlled state.
- File capabilities must reject sibling relative paths even when the root id is
  valid.

### Licensing

- Trial and education start endpoints should not reveal whether an email or
  device already exists.
- Device caps must be enforced atomically in database writes, not by a
  pre-count followed by insert/update.
- Historical license payloads are acceptable only for short renewal refresh
  handoff, not as indefinite valid tokens.

### Runtime Assets

- Web and desktop Python runtime loading should use the same checked, same-origin
  Pyodide asset tree.
- Service worker strategy should not keep a third-party runtime cache alive once
  same-origin assets are available.
- CSP should not allow third-party runtime script/connect origins for normal
  execution.

### Execution And Parsing

- User-controlled output is still attacker-controlled on successful exit.
- Parent-owned worker timeouts are required; child-side timeout code can hang
  with the worker.
- Parser caps should run against raw input, before trimming or transformation.
- Depth, node-count, and output-byte limits protect different failure modes and
  should be enforced separately.

### Diagnostics

- Privacy copy must describe actual behavior, not aspirational behavior.
- Raw exception messages require the same redaction treatment as stack traces.
- Redaction should handle bearer tokens, license-like tokens, URL query values,
  local paths, and `file://` URLs before payloads are persisted or copied.

## Residual Risk

- This review was code and local-validation based. It did not include live
  production traffic, deployed Cloudflare Workers, signed release artifacts, or
  end-to-end auto-update against a real draft release.
- React test warnings about missing `act(...)` remain in the test suite output.
  They did not fail validation, but they can hide future component timing bugs.
- The filesystem approval store is a local persistence boundary; future changes
  that add new reopen or import flows must continue using the same approval
  checks.
- Any future runtime asset upgrade should rerun the runtime asset lock workflow
  and offline/same-origin smoke checks.
