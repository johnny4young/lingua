# Security Policy

This repository is the static marketing site for Lingua. The desktop/web app is
maintained separately.

## Supported Versions

Security fixes are accepted against the `main` branch and the current production
deployment at https://linguacode.dev.

## Reporting a Vulnerability

Please do not publish exploit details, secrets, customer data, or bypass steps in
a public issue.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for this
   repository.
2. If that is unavailable, open a minimal public issue that says a private
   security report is needed, without including exploit details.

Include:

- Affected URL, route, or file.
- Clear reproduction steps.
- The practical impact.
- Any safe proof of concept that does not expose real secrets or customer data.

## High-Risk Areas

Review these areas carefully:

- Cloudflare Pages headers, especially CSP and cache behavior.
- Release/download links and SHA256SUMS references.
- Polar checkout URL handling.
- Cloudflare Web Analytics configuration.
- Content synchronized from the private `lingua` repository.
- Build scripts that generate public artifacts such as the press kit ZIP.
- Dependency updates that affect Astro, Vite, Tailwind, Markdown rendering, or
  static HTML output.

## Secret Handling

Never commit:

- GitHub, Cloudflare, Polar, Resend, or analytics tokens.
- Private access tokens for the source `lingua` repository.
- Webhook secrets.
- Real customer license tokens.
- Code-signing certificates, notarization credentials, or private keys.

If a secret is exposed, revoke or rotate it before opening a cleanup PR. Removing
the file from the latest commit is not enough once the value has entered Git
history.
