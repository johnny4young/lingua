# Usage reference

End-user reference for running Lingua: keyboard shortcuts, deep links, plugin format, browser-vs-desktop differences, update behavior. Contributor-facing setup lives in [`DEVELOPMENT.md`](./DEVELOPMENT.md); the marketing site at [linguacode.dev](https://linguacode.dev) hosts walkthroughs and screenshots.

## Keyboard shortcuts

The Keyboard Shortcuts overlay (Command Palette → `Open Keyboard Shortcuts`) supports search, inline rebinding, preset switching, and JSON export/import for override bundles. Import sanitizes unknown ids, malformed combos, and conflicting bindings before writing to settings.

| Action                  | macOS         | Windows / Linux |
| ----------------------- | ------------- | --------------- |
| Run or stop active file | `Cmd+Enter`   | `Ctrl+Enter`    |
| Save active tab         | `Cmd+S`       | `Ctrl+S`        |
| Close active tab        | `Cmd+W`       | `Ctrl+W`        |
| Toggle sidebar          | `Cmd+B`       | `Ctrl+B`        |
| Toggle console          | `Cmd+\`       | `Ctrl+\`        |
| Quick open              | `Cmd+P`       | `Ctrl+P`        |
| Command palette         | `Cmd+Shift+P` | `Ctrl+Shift+P`  |
| Search in files         | `Cmd+Shift+F` | `Ctrl+Shift+F`  |
| Go to symbol in file    | `Cmd+Shift+O` | `Ctrl+Shift+O`  |
| Settings                | `Cmd+,`       | `Ctrl+,`        |
| Close open overlay      | `Escape`      | `Escape`        |

## Desktop deep links

Packaged desktop builds register the `lingua://` protocol and handle these entry points:

- `lingua://open?file=/absolute/path/to/file.ts`
- `lingua://new?lang=python`
- `lingua://snippet?id=snippet-123`

Notes:

- `open` reuses an already-open tab when the target file is open, otherwise it opens the file from disk.
- `new` creates a fresh tab using the same starter content as the toolbar language actions.
- `snippet` opens the Snippet Library and focuses the matching saved snippet when that id exists locally.
- Web builds expose the same bridge shape internally for consistency, but the OS-level protocol registration is desktop-only.

## Update behavior

- Automatic updates are only active in packaged desktop builds on macOS and Windows.
- Linux desktop builds report updates as unavailable.
- Web builds poll `updates.linguacode.dev/web/version` and show a reload banner when the deployed web tag is strictly newer than the running bundle.
- The renderer exposes update state in Settings and a manual "Check for Updates" command in the command palette, which opens Settings so the current state and message are visible immediately.
- Restart-to-apply is only enabled after the main process reports that an update has been downloaded.
- The updater currently targets the stable GitHub Release channel only.

## Local plugins

Lingua supports a conservative local plugin model for language integrations:

- Plugin manifests are discovered from the app-local plugin directory at runtime.
- A manifest only enables runtimes that are already bundled with the current build.
- Arbitrary third-party code loading is intentionally out of scope today.
- Invalid, disabled, incompatible, or unsupported plugins are surfaced in Settings with explicit diagnostics.

Current plugin scope:

- Local language plugins are a supported product goal.
- The bundled Lua runtime is executable through Fengari once a local `lua` plugin manifest is installed.

Current install directory:

- Desktop builds discover plugins from `<app userData>/plugins`.
- Web builds keep the plugin surface read-only and do not load local manifests.

Minimal manifest:

```json
{
  "pluginId": "lua",
  "apiVersion": 1,
  "enabled": true,
  "minAppVersion": "0.1.0"
}
```

Manifest rules:

- `pluginId` must be a string and must match a bundled plugin runtime known to this build.
- `pluginId` must follow the safe-identifier pattern: lowercase alphanumeric and hyphens only, starting with an alphanumeric character, max 64 characters. Path-like ids (`..`, `lua/foo`, `.hidden`), uppercase, whitespace, and special characters are rejected.
- `apiVersion` is currently `1`.
- `enabled: false` keeps the plugin installed but inactive.
- `minAppVersion` and `maxAppVersion` gate compatibility against the running app version and must be numeric version strings such as `1`, `1.2`, or `1.2.3`.
- Manifests with extra unknown top-level fields are rejected as `invalid`. The schema is strict by design — only the fields documented above are accepted.

Diagnostic statuses surfaced in Settings → Plugins:

- `loaded` — manifest is valid, runtime is bundled, and the plugin is enabled.
- `disabled` — manifest is valid but `enabled: false`.
- `invalid` — manifest fails the schema (malformed JSON, missing or unsafe `pluginId`, unknown top-level fields).
- `incompatible` — manifest references an unsupported `apiVersion` or an app-version range outside the running build.
- `unknown` — manifest is well-formed, but its `pluginId` is not part of the bundled runtime allowlist for this build.
- `unavailable` — defensive fallback: the manifest claims `loaded` but the build cannot find a matching loader. Should not occur with a healthy build.

The plugin model is intentionally manifest-only. There is no facility to load arbitrary plugin executable code from a manifest; the bundled-runtime allowlist enforces that policy at validation time.

## Browser-only limitations

- Go compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Rust compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Desktop-style automatic updates stay unavailable in the browser build; web update detection uses the hosted version endpoint and reload banner.
- Local plugin discovery stays unavailable in the browser build.
- External file watching stays unavailable in the browser build.

## Browser file access

- The web build can open local folders through the File System Access API in supported browsers.
- Browser file access supports open, read, write, rename, create, and delete flows.
- File pickers stay scoped to code/text-oriented files so binary formats such as PDFs are not accidentally opened into the editor surface.
- Browser file watching is not available, so external edits are not reflected automatically.
