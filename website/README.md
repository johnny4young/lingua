# Lingua marketing site (`website/`)

[![License: source-available](https://img.shields.io/badge/license-source--available-informational)](LICENSE)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-f38020)](https://linguacode.dev)

The marketing site for Lingua at [linguacode.dev](https://linguacode.dev). Built with Astro + Tailwind v4, deployed to Cloudflare Pages.

This is a **standalone package inside the main [`lingua`](../) repo** — it has its own `package.json` / `package-lock.json` and is installed on its own (npm, not the repo's pnpm). Content (changelog, roadmap, press-kit, SEO pages) is vendored locally from the repo root by `scripts/sync-from-main.mjs` — no cross-repo sync. Deploys run from the root workflow [`.github/workflows/deploy-website.yml`](../.github/workflows/deploy-website.yml).

The desktop/web app lives at [app.linguacode.dev](https://app.linguacode.dev) and is built from the repo root, not from here.

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
