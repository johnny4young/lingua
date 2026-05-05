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
| `shepherd.js` | AGPL-3.0 unless commercially licensed |
| `spark-md5` | WTFPL OR MIT |
| `sql-formatter` | MIT |
| `terser` | BSD-2-Clause |
| `zustand` | MIT |

## Public-Release Blocker

`shepherd.js` is a runtime dependency used by the guided tour and currently
declares `AGPL-3.0`. A public commercial Lingua distribution must resolve this
before release by purchasing the appropriate commercial license, replacing the
dependency, or excluding the guided-tour feature from public builds.

## Release Requirement

Release artifacts must include or link to:

- a generated SBOM
- a transitive third-party license report
- this notice file or its generated successor
- confirmation that AGPL/commercial-license obligations have been resolved
