# Recovery and safe-mode boot (RL-090)

When something in Lingua corrupts persisted state — a bad import, a
faulty plugin, a half-written settings JSON — the app exposes three
escape hatches before you have to manually edit files: error
boundaries, safe mode, and the Recovery surface in Settings.

## Error boundaries

Every major shell region (toolbar, sidebar, editor, results panel,
console, settings overlay) is wrapped in a React error boundary. A
render-time crash in any one of them shows a fallback panel inside
that region instead of leaving the rest of the app unusable. The
fallback offers three actions:

- **Copy redacted error report** — puts a JSON blob on the clipboard
  with timestamp, region, error name + message (truncated), the
  redacted stack (no absolute paths, no `file://` URLs, no user
  folders), the app version, the platform, and the active locale.
  Safe to paste into a GitHub issue.
- **Reload in safe mode** — appends `?safe-mode=1` to the URL and
  reloads. Skips session restore, plugin discovery, and last-project
  re-open.
- **Reset to defaults** — only shown when the boundary's `onReset`
  prop is wired. Clears the boundary's local error state and
  re-renders the children.

React error boundaries do **not** catch async errors or event-handler
errors. The renderer also installs global `window.onerror` and
`window.onunhandledrejection` listeners that mark the next boot for
safe mode and feed the boot-loop counter described below — so any
uncaught crash, no matter the source, leads to a recoverable next
boot.

## Safe mode

Safe mode is opt-in via:

1. Adding `?safe-mode=1` to the URL.
2. Clicking **Reload in safe mode** in any error fallback.
3. Clicking **Reload in safe mode** under Settings → Account →
   Recovery.
4. Automatically when the previous boot crashed (the renderer marks
   `lingua-safe-mode = '1'` on catch and clears it on the next clean
   render).

Under safe mode the renderer skips:

- Tab and session restoration.
- Last-project re-open.
- Plugin discovery (the Plugins section will report "discovery
  skipped").

Settings, snippets, env vars, and the license are all still loaded —
safe mode is a partial bypass, not a wipe.

The active mode is mirrored on `<html data-recovery-state="...">` for
e2e tests and Playwright smokes (`normal`, `safe`, `factory`).

## Boot-loop counter and factory mode

If three crashes occur within 60 seconds, the renderer escalates to
**factory mode**: every localStorage key is cleared except
`lingua-license`, the data attribute flips to `factory`, and the user
is shown a recovery notice while the app boots with risky restore
paths skipped. Reload normally once you finish recovering — clean
renders auto-clear the factory flag.

Factory mode is the last line of defense. If you reach it
intentionally (e.g. clicking "Reset everything" in Recovery) your
license stays intact; you just lose preferences, snippets, env vars,
recent projects, and any tab restore data.

## Recovery surface (Settings → Account → Recovery)

Five scoped reset actions plus two affordances:

| Action | Wipes | Preserves |
|---|---|---|
| Reset editor settings | theme, font, layout, shortcuts, keymap, theme pack | telemetry consent, native-execution acknowledgement, license |
| Reset snippets | every saved snippet | everything else |
| Reset environment variables | global, project, and tab scopes | settings + snippets |
| Reset session and recent state | recent projects, execution history | preferences + saved data |
| Reset everything (keep license) | every localStorage key | `lingua-license` |
| Reload in safe mode | nothing — soft reload with `?safe-mode=1` | everything |
| Open recovery folder (desktop only) | nothing — opens the OS file browser | everything |

Each destructive action gates behind a native confirm modal via the
`recovery:confirm-reset` IPC. The web build stubs the modal as
"Cancel"; an inline notice ("Reset cancelled. Current data
unchanged.") surfaces so the click is never silently ignored.

## When the renderer cannot mount

If even safe mode cannot render — typically because settings JSON is
unparseable and Zustand's `persist` middleware throws on read — open
the recovery folder via your file browser and delete the offending
JSON manually. On macOS:

```
~/Library/Application Support/Lingua/
```

On Windows:

```
%APPDATA%\Lingua\
```

On Linux:

```
~/.config/Lingua/
```

The "Open recovery folder" button under Settings → Account → Recovery
is the same path. Web builds do not have a recovery folder — they
live entirely in the browser's localStorage, which the dev tools'
"Application" tab can clear directly.

## Reporting an issue

If you reach this doc because the app crashed, copy the redacted
error report from the boundary fallback and paste it into a GitHub
issue. The report contains no absolute paths, no user code, and no
secrets — it's safe to share verbatim.
