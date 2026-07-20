# R2 web-runtime storage

Cloudflare R2 hosts oversized immutable WebAssembly runtimes that exceed the
Cloudflare Pages per-file limit. It does not host desktop installers, updater
manifests, checksums, or release metadata; those live in GitHub Releases.

## Required configuration

The `deploy-web.yml` workflow uses:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_PUBLIC_BASE`, normally `https://downloads.linguacode.dev`

Runtime objects use this versioned layout:

```text
web-runtime/duckdb/<package-version>/duckdb-mvp.wasm
web-runtime/ruby/<package-version>/ruby+stdlib.wasm
```

The public host must return `Access-Control-Allow-Origin: *` or
`Access-Control-Allow-Origin: https://app.linguacode.dev`.

## Validation

```bash
pnpm run check:release-infra -- \
  --public-base https://downloads.linguacode.dev
```

A 404 for a newly bumped runtime warns before deploy because the workflow will
upload that immutable version. A 403, network error, Cloudflare challenge, or
HTTP 200 without valid CORS is release-blocking.

The website and desktop updater must never depend on this bucket. Validate
desktop distribution against the public GitHub Release instead.
