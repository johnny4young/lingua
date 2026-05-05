# Third-Party Notices

This file is the public-release notice index for packaged runtime dependencies.
The transitive package inventory lives in
[`docs/THIRD_PARTY_LICENSE_REPORT.md`](./docs/THIRD_PARTY_LICENSE_REPORT.md).

Regenerate and verify the release inventory with:

```bash
npm run license:report
npm run check:licenses
npm run compliance:release
```

## Runtime Dependencies

| Package | License |
| --- | --- |
| `@monaco-editor/react` | MIT |
| `@prettier/plugin-xml` | MIT |
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
| `pyodide` | Apache-2.0 |
| `qrcode` | MIT |
| `react` | MIT |
| `react-dom` | MIT |
| `react-i18next` | MIT |
| `react-resizable-panels` | MIT |
| `spark-md5` | WTFPL OR MIT |
| `sql-formatter` | MIT |
| `terser` | BSD-2-Clause |
| `zustand` | MIT |

## Public-Release Notes

The guided tour is implemented in-repo and does not ship a separate AGPL or
commercial-license tour dependency. Continue to audit runtime and packaged
dependencies before every public release.

The current transitive runtime license policy passes for 97 production
`package-lock.json` entries. Approved expressions are limited to MIT, ISC,
Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0, Python-2.0,
`MPL-2.0 OR Apache-2.0`, and `WTFPL OR MIT`. Missing, unreviewed,
AGPL/GPL/LGPL/SSPL, commercial, or proprietary expressions fail the release
license gate.

## Release Requirement

Release artifacts must include or link to:

- `lingua-sbom.cyclonedx.json`
- `THIRD_PARTY_LICENSE_REPORT.md`
- this notice file or its generated successor
- confirmation that AGPL/commercial-license obligations have been resolved
