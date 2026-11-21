# Third-Party Notices

This file is the public-release notice index for packaged runtime dependencies.
The transitive package inventory lives in
[`docs/THIRD_PARTY_LICENSE_REPORT.md`](./docs/THIRD_PARTY_LICENSE_REPORT.md).

Regenerate and verify the release inventory with:

```bash
pnpm run license:report
pnpm run check:licenses
pnpm run compliance:release
```

## Runtime Dependencies

| Package | License |
| --- | --- |
| `@duckdb/duckdb-wasm` | MIT |
| `@electron-stagewright/host-supervisor` | MIT |
| `@electron-stagewright/origin-migration` | MIT |
| `@monaco-editor/react` | MIT |
| `@prettier/plugin-xml` | MIT |
| `@vscode/ripgrep` | MIT |
| `cron-parser` | MIT |
| `cronstrue` | MIT |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `electron-squirrel-startup` | Apache-2.0 |
| `esbuild-wasm` | MIT |
| `fengari` | MIT |
| `i18next` | MIT |
| `js-yaml` | MIT |
| `lucide-react` | ISC |
| `marked` | MIT |
| `monaco-editor` | MIT |
| `monaco-vim` | MIT |
| `pyodide` | MPL-2.0 |
| `qrcode` | MIT |
| `react` | MIT |
| `react-dom` | MIT |
| `react-i18next` | MIT |
| `react-resizable-panels` | MIT |
| `spark-md5` | WTFPL OR MIT |
| `sql-formatter` | MIT |
| `terser` | BSD-2-Clause |
| `zustand` | MIT |

## Vendored Runtime Files

| File | Source | License |
| --- | --- | --- |
| `vendor/duckdb-extensions/v1.4.3/wasm_eh/json.duckdb_extension.wasm` | [DuckDB](https://github.com/duckdb/duckdb) | MIT |
| `vendor/duckdb-extensions/v1.4.3/wasm_eh/icu.duckdb_extension.wasm` | [DuckDB](https://github.com/duckdb/duckdb) | MIT, with ICU under the Unicode license |
| `vendor/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` | [DuckDB](https://github.com/duckdb/duckdb) | MIT, with Apache Thrift (Apache-2.0), Snappy (BSD-3-Clause), LZ4 (BSD-2-Clause) and Brotli (MIT) |

## Bundled Fonts

| Font | License | Files |
| --- | --- | --- |
| Inter (latin 400, 500, 600) | OFL-1.1 | `public/fonts/inter-latin-*-normal.woff2`, `public/fonts/Inter-OFL.txt` |
| JetBrains Mono (latin 400, 700) | OFL-1.1 | `public/fonts/jetbrains-mono-latin-*-normal.woff2`, `public/fonts/OFL.txt` |
| Fraunces (latin, variable roman and italic) | OFL-1.1 | `public/fonts/fraunces-latin-variable.woff2`, `public/fonts/fraunces-latin-variable-italic.woff2`, `public/fonts/Fraunces-OFL.txt` |
| Recursive (latin, variable) | OFL-1.1 | `public/fonts/recursive-latin-variable.woff2`, `public/fonts/Recursive-OFL.txt` |

Fraunces and Recursive are subset and axis-instanced from the google/fonts
sources by `scripts/fonts/build-variable-fonts.sh`.

## Public-Release Notes

The guided tour is implemented in-repo and does not ship a separate AGPL or
commercial-license tour dependency. Continue to audit runtime and packaged
dependencies before every public release.

The current transitive runtime license policy covers the production dependency
tree plus explicitly copied runtime components such as the packaged ripgrep
executable. Approved expressions are limited to MIT, ISC,
0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0, Python-2.0,
MPL-2.0, `MPL-2.0 OR Apache-2.0`, and `WTFPL OR MIT`. Missing, unreviewed,
AGPL/GPL/LGPL/SSPL, commercial, or proprietary expressions fail the release
license gate.

## Release Requirement

Release artifacts must include or link to:

- `lingua-sbom.cyclonedx.json`
- `THIRD_PARTY_LICENSE_REPORT.md`
- this notice file or its generated successor
- confirmation that AGPL/commercial-license obligations have been resolved
