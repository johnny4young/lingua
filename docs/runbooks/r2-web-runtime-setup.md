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

After each upload, `deploy-web.yml` runs
`scripts/verify-web-runtime-mirror.mjs` against the public URL and the exact
local WASM file used for the upload. It requires HTTP 200, the production app's
CORS origin (or `*`), `application/wasm`, and byte-for-byte SHA-256 equality.
The verifier streams both copies rather than buffering the large payloads.
A wrong digest, missing object, redirect, edge challenge, or wrong MIME blocks
Pages promotion; do not bypass the check by changing the expected hash or
uploading an unreviewed file. Client-side SRI remains a separate last line of
defense. A local fixture test exercises successful and rejected responses;
it does not claim the production bucket has been checked before a real deploy.

The website and desktop updater must never depend on this bucket. Validate
desktop distribution against the public GitHub Release instead.
