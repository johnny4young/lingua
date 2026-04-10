# TEST_PLAN.md

## Purpose

This document defines the executable end-to-end test matrix for RunLang across both supported surfaces:

- `web`: fast renderer/UI validation through local preview
- `electron`: full desktop validation including local filesystem access, native/compiled language support, and Electron-specific behavior

The goal is to make future automation straightforward with:

- Playwright Web
- Playwright Electron

This file is intentionally implementation-oriented. It is not a roadmap; it is the source of truth for future E2E coverage planning.

## Status Legend

- `✅ passed`
- `❌ failed`
- `⛔ blocked`
- `🕒 pending`

## Test Surfaces

### Web

Use the web flow for:

- shell UI
- toolbar
- overlays
- settings
- themes
- snippets
- command palette
- quick open
- console UI
- result panel UI
- responsive behavior
- browser-supported language execution

### Electron

Use the desktop flow for:

- Go and Rust execution
- local filesystem integration
- project explorer against real folders
- file watching
- plugin discovery
- updater state and actions
- preload/main bridge behavior
- Electron-specific startup and shutdown validation

## Standard Preconditions

### Web Base

```bash
npm run build:web
npm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

### Electron Base

Use the managed desktop launcher once stable:

```bash
npm run desktop:dev
```

Or when main/preload changes require sync:

```bash
npm run desktop:dev:sync
```

Desktop baseline must guarantee:

- renderer dev server is reachable
- Electron window opens without `chrome-error://chromewebdata/`
- closing Electron does not leave orphaned renderer/server processes
- compact-width shell behavior keeps the editor usable, with the sidebar switching to an overlay drawer instead of collapsing into an unusable split

## Fixtures

- `PROJECT_FIXTURE`
  - nested directories
  - multiple languages
  - empty directory
  - rename/delete-safe throwaway files
- `PLUGIN_FIXTURE`
  - optional local plugin manifests for desktop validation
- `LANG_FIXTURE`
  - runnable and failing examples for JS, TS, Python, Go, Rust

## Selector Strategy

Use this order when automating:

1. `getByRole(...)`
2. `title`
3. stable visible text
4. future improvement: add `data-testid` to high-value shell and overlay elements

## Tags

- `smoke`
- `regression`
- `responsive`
- `language`
- `desktop-only`

## Matrix

## Shell / Layout / Navigation

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-001` | `WEB` | `developer` | Open app | Toolbar, shell, and welcome state render without fatal error |
| ✅ | `TC-002` | `ELEC` | `developer` | Open app | Main window opens and shell renders without `chrome-error` |
| 🕒 | `TC-003` | `WEB` | `developer` | Inspect toolbar | Buttons exist: sidebar, run, new file, quick open, command palette, snippets, console, settings |
| ✅ | `TC-004` | `ELEC` | `developer` | Inspect toolbar | Same controls exist in desktop shell |
| ✅ | `TC-005` | `BOTH` | `developer` | Click `Settings` | Settings modal opens |
| ✅ | `TC-006` | `BOTH` | `developer` | Close settings by close button and backdrop | Settings modal closes both ways |
| ✅ | `TC-007` | `BOTH` | `developer` | Click `Snippets` | Snippets modal opens |
| ✅ | `TC-008` | `BOTH` | `developer` | Open command palette | Palette opens and focus lands in search input |
| ✅ | `TC-009` | `BOTH` | `developer` | Toggle sidebar | Sidebar changes visible/hidden |
| ✅ | `TC-010` | `BOTH` | `developer` | Toggle console | Console panel changes visible/hidden |
| ✅ | `TC-011` | `BOTH` | `developer` | With no tabs, inspect `Run` | Run is disabled |
| ✅ | `TC-012` | `BOTH` | `developer` | Create JS file from primary new-file action | JS tab is created and becomes active |
| ✅ | `TC-013` | `BOTH` | `developer` | Open new-file menu and create Go file | Go tab is created |
| ✅ | `TC-014` | `BOTH` | `developer` | Open multiple tabs and switch active tab | Active tab changes correctly |
| ✅ | `TC-015` | `BOTH` | `developer` | Edit tab content | Dirty indicator appears |
| ✅ | `TC-016` | `BOTH` | `developer` | Close inactive tab | Tab disappears without breaking selection |
| ✅ | `TC-017` | `BOTH` | `developer` | Close active tab | Focus moves to another tab or empty state |
| ✅ | `TC-018` | `BOTH` | `developer` | Open template from welcome state | Tab opens with expected code |
| ✅ | `TC-019` | `BOTH` | `developer` | Use quick-start language button | Tab opens in selected language |
| ✅ | `TC-020` | `BOTH` | `developer` | Inspect empty-state shortcut hints | `Cmd+Shift+P`, `Cmd+B`, `Cmd+Enter` hints are visible |

## Command Palette / Quick Open

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-021` | `BOTH` | `developer` | Open command palette, search template | Matching results are shown |
| ✅ | `TC-022` | `BOTH` | `developer` | Use `ArrowDown/ArrowUp` in palette | Selection changes |
| ✅ | `TC-023` | `BOTH` | `developer` | Press `Enter` on template in palette | Template opens in tab |
| ✅ | `TC-024` | `BOTH` | `developer` | Search action `Open Settings` | Correct action runs |
| ✅ | `TC-025` | `BOTH` | `developer` | Search snippets in palette | Saved snippets appear |
| ✅ | `TC-026` | `BOTH` | `developer` | Press `Escape` in palette | Palette closes |
| ✅ | `TC-027` | `BOTH` | `developer` | Open quick open with tabs/project | Open tabs and project files are listed |
| ✅ | `TC-028` | `BOTH` | `developer` | Search by file name in quick open | Results filter by name |
| ✅ | `TC-029` | `BOTH` | `developer` | Search by path in quick open | Results filter by path |
| ✅ | `TC-030` | `BOTH` | `developer` | Press `Enter` on quick open result | Existing tab activates or file opens |

## Snippets

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-031` | `BOTH` | `developer` | Open snippets when empty | Empty state is shown |
| ✅ | `TC-032` | `BOTH` | `developer` | Click `Save Active Tab` | Snippet form is prefilled from active tab |
| ✅ | `TC-033` | `BOTH` | `developer` | Save a new snippet | Snippet appears in the list |
| ✅ | `TC-034` | `BOTH` | `developer` | Edit existing snippet | Changes persist in UI/store |
| ✅ | `TC-035` | `BOTH` | `developer` | Click `Open in New Tab` from snippet | New tab opens with snippet code |
| ✅ | `TC-036` | `BOTH` | `developer` | Click `Insert into Active Tab` | Snippet code is inserted into current tab |
| ✅ | `TC-037` | `BOTH` | `developer` | Delete snippet | Snippet disappears |
| ✅ | `TC-038` | `BOTH` | `developer` | Open snippets from command palette | Snippets modal opens |
| ✅ | `TC-039` | `BOTH` | `developer` | Close snippets by button and backdrop | Snippets modal closes |
| ✅ | `TC-040` | `BOTH` | `developer` | Reload app | Snippets persist |

## Settings / Updates / Plugins

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-041` | `BOTH` | `developer` | Open settings > appearance | Dark and light shell options are visible |
| ✅ | `TC-042` | `BOTH` | `developer` | Switch to light mode | Shell changes to light theme and persists |
| ✅ | `TC-043` | `BOTH` | `developer` | Switch to dark mode | Shell changes to dark theme and persists |
| ✅ | `TC-044` | `BOTH` | `developer` | Change editor theme | Monaco theme changes |
| ✅ | `TC-045` | `BOTH` | `developer` | Change font family | Monaco uses selected font |
| ✅ | `TC-046` | `BOTH` | `developer` | Change font size | Monaco font size changes |
| ✅ | `TC-047` | `BOTH` | `developer` | Toggle line numbers | Monaco gutter updates |
| ✅ | `TC-048` | `BOTH` | `developer` | Toggle word wrap | Monaco wrapping updates |
| ✅ | `TC-049` | `BOTH` | `developer` | Toggle minimap | Monaco minimap updates |
| ✅ | `TC-050` | `BOTH` | `developer` | Change layout horizontal/vertical/editor-only | Shell panels rearrange correctly |
| 🕒 | `TC-051` | `WEB` | `developer` | Open settings > updates | Unsupported web update message is shown and controls are disabled |
| ✅ | `TC-052` | `ELEC` | `developer` | Open settings > updates | Desktop update state renders correctly |
| ✅ | `TC-053` | `ELEC` | `developer` | Click `Check now` | Update flow starts without crash |
| 🕒 | `TC-054` | `WEB` | `developer` | Open settings > plugins | Web shows unavailable/not-supported plugin state |
| ✅ | `TC-055` | `ELEC` | `developer` | Click `Refresh` in plugins | Refresh runs without crash |
| ✅ | `TC-056` | `ELEC` | `developer` | Inspect plugin list | Installed plugins show name, status, and message |

## Explorer / Project Files

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-057` | `ELEC` | `developer` | Open fixture project | Explorer shows expected tree |
| ✅ | `TC-058` | `ELEC` | `developer` | Expand/collapse directories | Directory state changes correctly |
| ✅ | `TC-059` | `ELEC` | `developer` | Open file from explorer | Tab opens with correct content |
| ✅ | `TC-060` | `ELEC` | `developer` | Create root file | File appears in tree |
| ✅ | `TC-061` | `ELEC` | `developer` | Create root folder | Folder appears in tree |
| ✅ | `TC-062` | `ELEC` | `developer` | Create file inside folder | File appears in correct directory |
| ✅ | `TC-063` | `ELEC` | `developer` | Rename file/folder | Tree updates with new name |
| ✅ | `TC-064` | `ELEC` | `developer` | Delete file/folder | Entry disappears |
| ✅ | `TC-065` | `ELEC` | `developer` | Click refresh tree | Tree reloads and expansion remains coherent |
| ✅ | `TC-066` | `ELEC` | `developer` | Modify filesystem outside app | Watch sync updates tree automatically |

## Console / Results

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-067` | `BOTH` | `developer` | Run code and inspect console | Console shows logs |
| ✅ | `TC-068` | `BOTH` | `developer` | Toggle log/info/warn/error filters | Visible entries change correctly |
| ✅ | `TC-069` | `BOTH` | `developer` | Toggle timestamps | Timestamps show/hide |
| ✅ | `TC-070` | `BOTH` | `developer` | Click clear console | Console becomes empty |
| ✅ | `TC-071` | `BOTH` | `developer` | Inspect result panel | Inline results align with editor lines |
| ✅ | `TC-072` | `BOTH` | `developer` | Inspect result panel | Full output view renders |
| ✅ | `TC-073` | `BOTH` | `developer` | Toggle `undef` | Undefined results hide/show |
| ✅ | `TC-074` | `BOTH` | `developer` | Run failing code | Error is visible with line info if available |
| ✅ | `TC-075` | `BOTH` | `developer` | Run code | Execution time appears |

## Languages

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-076` | `WEB` | `developer` | Run JS hello world | Output is correct |
| 🕒 | `TC-077` | `WEB` | `developer` | Run JS with multiple logs | Console shows all logs in order |
| 🕒 | `TC-078` | `WEB` | `developer` | Run JS runtime error | Error renders without crashing shell |
| 🕒 | `TC-079` | `WEB` | `developer` | Run JS infinite loop candidate | Loop protection stops execution as expected |
| 🕒 | `TC-080` | `WEB` | `developer` | Run TS hello world | Output is correct |
| 🕒 | `TC-081` | `WEB` | `developer` | Run TS type error case | Type/compile error is shown |
| 🕒 | `TC-082` | `WEB` | `developer` | Run Python print | Output is correct |
| 🕒 | `TC-083` | `WEB` | `developer` | Run Python syntax/runtime error | Error renders correctly |
| 🕒 | `TC-084` | `WEB` | `developer` | Open Go/Rust in web | Explicit limitation or supported behavior is shown correctly |
| ✅ | `TC-085` | `ELEC` | `developer` | Run JS hello world | Output is correct |
| ✅ | `TC-086` | `ELEC` | `developer` | Run TS hello world | Output is correct |
| ✅ | `TC-087` | `ELEC` | `developer` | Run Python hello world | Output is correct |
| ✅ | `TC-088` | `ELEC` | `developer` | Run Go hello world | Compile and execution succeed |
| ✅ | `TC-089` | `ELEC` | `developer` | Run Go compile error case | Compile error is visible |
| ✅ | `TC-090` | `ELEC` | `developer` | Run Rust hello world | Compile and execution succeed |
| ✅ | `TC-091` | `ELEC` | `developer` | Run Rust compile error case | Compile error is visible |

## Responsive / Persistence / Shutdown

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-092` | `WEB` | `developer` | Run on mobile viewport | Toolbar, overlays, and compact sidebar drawer remain usable, no critical overflow, the drawer closes via backdrop, close button, or `Escape`, focus returns cleanly after dismissal, keyboard focus stays trapped inside while open, and the background shell stays inert with scrolling locked until close |
| 🕒 | `TC-093` | `WEB` | `developer` | Run on tablet viewport | Settings, snippets, and compact shell transitions adapt layout correctly, the explorer transitions from drawer to persistent sidebar without losing usability, and temporary modal locks are cleared after widening |
| 🕒 | `TC-094` | `WEB` | `developer` | Run on wide desktop viewport | Shell, persisted sidebar width, and welcome state render without clipping |
| ✅ | `TC-095` | `ELEC` | `developer` | Open then close app | No orphaned processes remain |
| ✅ | `TC-096` | `ELEC` | `developer` | Reopen app after close | App starts cleanly again |
| ✅ | `TC-097` | `ELEC` | `developer` | Trigger shortcuts `Cmd+B`, `Cmd+\\`, `Cmd+P`, `Cmd+Shift+P`, `Cmd+,`, `Cmd+Enter` | Correct shell actions run |
| ✅ | `TC-098` | `BOTH` | `developer` | Reload app | Theme, layout, snippets, and editor settings persist |
| ✅ | `TC-099` | `BOTH` | `developer` | No project and no tabs | Empty state and CTAs are correct |
| ✅ | `TC-100` | `BOTH` | `developer` | End of suite cleanup | No blocking console errors and no zombie process left |

## Suite Grouping

### `suite-smoke`

- `TC-001` to `TC-010`

### `suite-shell`

- `TC-011` to `TC-030`

### `suite-snippets-settings`

- `TC-031` to `TC-056`

### `suite-explorer-desktop`

- `TC-057` to `TC-066`

### `suite-console-results`

- `TC-067` to `TC-075`

### `suite-languages-web`

- `TC-076` to `TC-084`

### `suite-languages-electron`

- `TC-085` to `TC-091`

### `suite-responsive`

- `TC-092` to `TC-094`

### `suite-persistence-shutdown`

- `TC-095` to `TC-100`

## Suggested Future File Layout

### Web

- `tests/e2e/web/smoke.spec.ts`
- `tests/e2e/web/shell.spec.ts`
- `tests/e2e/web/settings.spec.ts`
- `tests/e2e/web/snippets.spec.ts`
- `tests/e2e/web/languages.spec.ts`
- `tests/e2e/web/responsive.spec.ts`

### Electron

- `tests/e2e/electron/smoke.spec.ts`
- `tests/e2e/electron/explorer.spec.ts`
- `tests/e2e/electron/settings.spec.ts`
- `tests/e2e/electron/languages.spec.ts`
- `tests/e2e/electron/integrations.spec.ts`

## Standard Test Metadata Template

Each automated test should record:

- `id`
- `title`
- `target`
- `tags`
- `preconditions`
- `steps`
- `assertions`
- `artifacts`

## Exit Criteria For Stable Coverage

Do not treat the app as E2E-stable unless the following minimum suites pass:

- `suite-smoke`
- `suite-shell`
- `suite-snippets-settings`
- `suite-console-results`
- `suite-languages-web`
- `suite-languages-electron`
- `suite-persistence-shutdown`
