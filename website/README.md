# lingua-marketing

[![CI](https://github.com/johnny4young/lingua-marketing/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/johnny4young/lingua-marketing/actions/workflows/ci.yml)
[![License: source-available](https://img.shields.io/badge/license-source--available-informational)](LICENSE)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-f38020)](https://linguacode.dev)

The marketing site for Lingua at [linguacode.dev](https://linguacode.dev). Built with Astro 6 + Tailwind v4, deployed to Cloudflare Pages.

The desktop/web app lives at [app.linguacode.dev](https://app.linguacode.dev) and is **not** part of this repo.

## Audience and constraints

This site targets senior developers. Three rules govern every change:

1. **No unverified claims.** Every sentence must map to shipped behavior.
2. **No third-party JS analytics.** Cloudflare's first-party Web Analytics is the only allowance.
3. **No fonts from CDN.** Inter and JetBrains Mono are self-hosted.

## License and contributions

This repo is public, but the source is **source-available** under [`LICENSE`](LICENSE), not open source. Public issues and PRs are welcome.

- Contribution workflow and local setup: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Vulnerability reporting and secret-handling policy: [`SECURITY.md`](SECURITY.md)

Do not commit secrets, real license tokens, private app data, or unverified product claims.
