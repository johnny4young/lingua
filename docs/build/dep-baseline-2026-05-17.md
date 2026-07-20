# Dependency baseline — 2026-05-17 (pre-sweep)

Captured immediately before the post-internal modernization sweep.

## `npm outdated`

```
Package                      Current  Wanted  Latest  Location                                  Depended by
@electron/fuses                1.8.0   1.8.0   2.1.1  node_modules/@electron/fuses              lingua
@eslint/js                    9.39.4  9.39.4  10.0.1  node_modules/@eslint/js                   lingua
electron                      41.6.1  41.6.1  42.1.0  node_modules/electron                     lingua
esbuild-wasm                  0.27.7  0.27.7  0.28.0  node_modules/esbuild-wasm                 lingua
eslint                        9.39.4  9.39.4  10.4.0  node_modules/eslint                       lingua
eslint-plugin-react-hooks      5.2.0   5.2.0   7.1.1  node_modules/eslint-plugin-react-hooks    lingua
eslint-plugin-react-refresh   0.4.26  0.4.26   0.5.2  node_modules/eslint-plugin-react-refresh  lingua
pyodide                       0.26.4  0.26.4  0.29.4  node_modules/pyodide                      lingua
typescript                     5.9.3   5.9.3   6.0.3  node_modules/typescript                   lingua
```

## `npm audit` summary

```
        "node_modules/@electron-forge/core"
      ],
      "fixAvailable": true
    },
    "@electron-forge/core-utils": {
      "name": "@electron-forge/core-utils",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@electron-forge/shared-types",
        "@electron/rebuild"
      ],
      "effects": [
        "@electron-forge/cli",
        "@electron-forge/template-base"
      ],
      "range": "<=8.0.0-alpha.4",
      "nodes": [
        "node_modules/@electron-forge/core-utils"
      ],
      "fixAvailable": false
    },
    "@electron-forge/maker-base": {
      "name": "@electron-forge/maker-base",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@electron-forge/shared-types"
      ],
      "effects": [],
      "range": "<=8.0.0-alpha.4",
      "nodes": [
        "node_modules/@electron-forge/maker-base"
      ],
      "fixAvailable": true
    },
    "@electron-forge/maker-deb": {
      "name": "@electron-forge/maker-deb",
      "severity": "high",
      "isDirect": true,
```

---

## After-sweep `npm outdated` (2026-05-17)

```
Package          Current  Wanted  Latest  Location                      Depended by
@electron/fuses    1.8.0   1.8.0   2.1.1  node_modules/@electron/fuses  lingua
```

Hold-backs documented in `tests/build/depFreshness.test.ts#HELD_BACK`.

## After-sweep `npm audit` (2026-05-17)

- `npm audit --omit=dev`: 0 vulnerabilities after the DOMPurify override
  dedupes Monaco's nested 3.2.7 copy to the direct 3.4.4 install.
- `npm audit`: 32 dev-only advisories remain in the Electron Forge /
  rebuild / Inquirer chain. Clearing them is gated on a Forge upgrade that
  also unblocks the `@electron/fuses` v2 hold-back.
