# Security Policy

Lingua is a source-available commercial desktop and web code runner. Security
reports are welcome, but please do not post exploit details, license tokens,
private keys, signing material, customer data, or sensitive file paths in a
public issue.

## Supported Versions

Until the first public stable release, security fixes target `main` and the
latest draft/release candidate. After public distribution begins, supported
versions will be documented in the release notes and on `linguacode.dev`.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting when it is enabled for this
repository. If that surface is unavailable, open a minimal issue that says a
private security report is needed, without technical exploit details or
secrets.

Include enough information for maintainers to reproduce the issue privately:

- affected surface: desktop app, web app, license server, update server, release
  workflow, or documentation
- affected version, commit, or release tag
- high-level impact
- safe reproduction steps that avoid exposing user code or credentials

## High-Risk Areas

Security reviews should pay special attention to:

- Electron main/preload boundaries and navigation policy
- filesystem capability grants, symlink handling, and protected-path blocks
- JavaScript, TypeScript, Python, Go, and Rust runner isolation
- local native toolchain execution and environment filtering
- license token verification, device tracking, recovery, trials, and education
  flows
- update feed behavior and release artifact integrity
- telemetry and crash-reporting consent plus payload redaction

## Secret Handling

Never commit production secrets. The following belong only in GitHub Actions,
Cloudflare Workers secrets, Apple/Windows signing stores, or local ignored env
files:

- private Ed25519 license-signing keys
- Polar, Resend, GitHub, or Cloudflare API tokens
- webhook secrets
- Apple or Windows signing certificates and passwords
- real customer license tokens

The repository may contain public keys, local test fixtures, and dummy secrets
used by tests. Production private material must be rotated immediately if it is
ever exposed.
