# Third-Party Notices

This file is the public-release starting point for runtime dependency notices.
Before a public binary release, this inventory must be expanded into a generated
SBOM plus transitive license report as tracked by `RL-085`.

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

## Release Requirement

Release artifacts must include or link to:

- a generated SBOM
- a transitive third-party license report
- this notice file or its generated successor
- confirmation that AGPL/commercial-license obligations have been resolved
