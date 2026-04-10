# TEST_PLAN.md

## Purpose

This document defines the executable end-to-end test matrix for RunLang across both supported surfaces:

- `web`: fast renderer/UI validation through local preview
- `electron`: full desktop validation including local filesystem access, native/compiled language support, and Electron-specific behavior

The goal is to make future automation straightforward with:

- Playwright Web
- Playwright Electron

This file is intentionally implementation-oriented. It is not a roadmap; it is the source of truth for future E2E coverage planning.

## Execution Tracking

Use this section to prevent rerunning already-validated cases. Each execution record must capture the exact case range, date, surface, status, and evidence path.

### Status Legend

- `passed`
- `failed`
- `blocked`
- `pending`
- `not-run-in-this-surface`

### Execution Records

| Date | Surface | Cases | Status | Evidence | Notes |
|---|---|---|---|---|---|
| `2026-04-10` | electron | `TC-001`, `TC-003`, `TC-051`, `TC-054`, `TC-076`-`TC-084`, `TC-092`-`TC-094` | `not-run-in-this-surface` | n/a | Web-only cases intentionally skipped during the desktop execution pass. |
| `2026-04-10` | electron | `TC-002`, `TC-004`-`TC-020` | `passed` | `output/playwright/electron-shell-suite.png`, `output/playwright/electron-shell-tabs-a11y.png` | Shell, welcome state, new-file flow, tab semantics, and dirty-state visibility validated after improving `EditorTabs` accessibility. |
| `2026-04-10` | electron | `TC-021`-`TC-026`, `TC-031`-`TC-056` | `passed` | `output/playwright/electron-overlays-settings-snippets.png`, `output/playwright/electron-settings-updates-plugins.png`, `output/playwright/electron-snippets-crud.png` | Command palette, settings, updates/plugins dev-state, and snippets CRUD validated. `TC-053` passed as a dev-build disabled-state check. After `Insert into Active Tab`, the snippet must be reselected before `Delete` becomes available again. |
| `2026-04-10` | electron | `TC-027`-`TC-030`, `TC-057`-`TC-059` | `passed` | `output/playwright/electron-explorer-quickopen.png` | Project fixture opened inside the desktop app, directory expansion worked, files opened into tabs, and quick open filtered by name/path correctly. |
| `2026-04-10` | electron | `TC-060`-`TC-066` | `blocked` | `output/playwright/electron-explorer-crud-watch.png` | Partial validation only. Root/file-tree CRUD and watch sync reached the real desktop explorer, but exact automation of hover-only controls and long-running Electron sessions became unstable due repeated REPL resets and brittle hover interactions. Resume from this range only. |

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
npm exec vite preview -- --config vite.web.config.ts --host 127.0.0.1 --port 4173
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

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-001` | web | smoke | `WEB_BASE` | Open app | Toolbar, shell, and welcome state render without fatal error |
| `TC-002` | electron | smoke | `DESKTOP_BASE` | Open app | Main window opens and shell renders without `chrome-error` |
| `TC-003` | web | smoke | `WEB_BASE` | Inspect toolbar | Buttons exist: sidebar, run, new file, quick open, command palette, snippets, console, settings |
| `TC-004` | electron | smoke | `DESKTOP_BASE` | Inspect toolbar | Same controls exist in desktop shell |
| `TC-005` | shared | regression | base | Click `Settings` | Settings modal opens |
| `TC-006` | shared | regression | base | Close settings by close button and backdrop | Settings modal closes both ways |
| `TC-007` | shared | regression | base | Click `Snippets` | Snippets modal opens |
| `TC-008` | shared | regression | base | Open command palette | Palette opens and focus lands in search input |
| `TC-009` | shared | regression | base | Toggle sidebar | Sidebar changes visible/hidden |
| `TC-010` | shared | regression | base | Toggle console | Console panel changes visible/hidden |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-011` | shared | regression | base | With no tabs, inspect `Run` | Run is disabled |
| `TC-012` | shared | regression | base | Create JS file from primary new-file action | JS tab is created and becomes active |
| `TC-013` | shared | regression | base | Open new-file menu and create Go file | Go tab is created |
| `TC-014` | shared | regression | base | Open multiple tabs and switch active tab | Active tab changes correctly |
| `TC-015` | shared | regression | base | Edit tab content | Dirty indicator appears |
| `TC-016` | shared | regression | base | Close inactive tab | Tab disappears without breaking selection |
| `TC-017` | shared | regression | base | Close active tab | Focus moves to another tab or empty state |
| `TC-018` | shared | regression | base | Open template from welcome state | Tab opens with expected code |
| `TC-019` | shared | regression | base | Use quick-start language button | Tab opens in selected language |
| `TC-020` | shared | regression | base | Inspect empty-state shortcut hints | `Cmd+Shift+P`, `Cmd+B`, `Cmd+Enter` hints are visible |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-021` | shared | regression | base | Open command palette, search template | Matching results are shown |
| `TC-022` | shared | regression | base | Use `ArrowDown/ArrowUp` in palette | Selection changes |
| `TC-023` | shared | regression | base | Press `Enter` on template in palette | Template opens in tab |
| `TC-024` | shared | regression | base | Search action `Open Settings` | Correct action runs |
| `TC-025` | shared | regression | base with saved snippets | Search snippets in palette | Saved snippets appear |
| `TC-026` | shared | regression | base | Press `Escape` in palette | Palette closes |
| `TC-027` | shared | regression | `PROJECT_FIXTURE` | Open quick open with tabs/project | Open tabs and project files are listed |
| `TC-028` | shared | regression | `PROJECT_FIXTURE` | Search by file name in quick open | Results filter by name |
| `TC-029` | shared | regression | `PROJECT_FIXTURE` | Search by path in quick open | Results filter by path |
| `TC-030` | shared | regression | `PROJECT_FIXTURE` | Press `Enter` on quick open result | Existing tab activates or file opens |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-031` | shared | regression | base | Open snippets when empty | Empty state is shown |
| `TC-032` | shared | regression | base with active tab | Click `Save Active Tab` | Snippet form is prefilled from active tab |
| `TC-033` | shared | regression | base | Save a new snippet | Snippet appears in the list |
| `TC-034` | shared | regression | base | Edit existing snippet | Changes persist in UI/store |
| `TC-035` | shared | regression | base | Click `Open in New Tab` from snippet | New tab opens with snippet code |
| `TC-036` | shared | regression | base with active tab | Click `Insert into Active Tab` | Snippet code is inserted into current tab |
| `TC-037` | shared | regression | base | Delete snippet | Snippet disappears |
| `TC-038` | shared | regression | base | Open snippets from command palette | Snippets modal opens |
| `TC-039` | shared | regression | base | Close snippets by button and backdrop | Snippets modal closes |
| `TC-040` | shared | regression | base | Reload app | Snippets persist |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-041` | shared | regression | base | Open settings > appearance | Dark and light shell options are visible |
| `TC-042` | shared | regression | base | Switch to light mode | Shell changes to light theme and persists |
| `TC-043` | shared | regression | base | Switch to dark mode | Shell changes to dark theme and persists |
| `TC-044` | shared | regression | base | Change editor theme | Monaco theme changes |
| `TC-045` | shared | regression | base | Change font family | Monaco uses selected font |
| `TC-046` | shared | regression | base | Change font size | Monaco font size changes |
| `TC-047` | shared | regression | base | Toggle line numbers | Monaco gutter updates |
| `TC-048` | shared | regression | base | Toggle word wrap | Monaco wrapping updates |
| `TC-049` | shared | regression | base | Toggle minimap | Monaco minimap updates |
| `TC-050` | shared | regression | base | Change layout horizontal/vertical/editor-only | Shell panels rearrange correctly |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-051` | web | regression | `WEB_BASE` | Open settings > updates | Unsupported web update message is shown and controls are disabled |
| `TC-052` | electron | regression | `DESKTOP_BASE` | Open settings > updates | Desktop update state renders correctly |
| `TC-053` | electron | desktop-only | `DESKTOP_BASE` | Click `Check now` | Update flow starts without crash |
| `TC-054` | web | regression | `WEB_BASE` | Open settings > plugins | Web shows unavailable/not-supported plugin state |
| `TC-055` | electron | desktop-only | `DESKTOP_BASE` | Click `Refresh` in plugins | Refresh runs without crash |
| `TC-056` | electron | desktop-only | `DESKTOP_BASE`, `PLUGIN_FIXTURE` | Inspect plugin list | Installed plugins show name, status, and message |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-057` | electron | desktop-only | `PROJECT_FIXTURE` | Open fixture project | Explorer shows expected tree |
| `TC-058` | electron | desktop-only | `PROJECT_FIXTURE` | Expand/collapse directories | Directory state changes correctly |
| `TC-059` | electron | desktop-only | `PROJECT_FIXTURE` | Open file from explorer | Tab opens with correct content |
| `TC-060` | electron | desktop-only | `PROJECT_FIXTURE` | Create root file | File appears in tree |
| `TC-061` | electron | desktop-only | `PROJECT_FIXTURE` | Create root folder | Folder appears in tree |
| `TC-062` | electron | desktop-only | `PROJECT_FIXTURE` | Create file inside folder | File appears in correct directory |
| `TC-063` | electron | desktop-only | `PROJECT_FIXTURE` | Rename file/folder | Tree updates with new name |
| `TC-064` | electron | desktop-only | `PROJECT_FIXTURE` | Delete file/folder | Entry disappears |
| `TC-065` | electron | desktop-only | `PROJECT_FIXTURE` | Click refresh tree | Tree reloads and expansion remains coherent |
| `TC-066` | electron | desktop-only | `PROJECT_FIXTURE` | Modify filesystem outside app | Watch sync updates tree automatically |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-067` | shared | regression | base with runnable tab | Run code and inspect console | Console shows logs |
| `TC-068` | shared | regression | base with multiple console entries | Toggle log/info/warn/error filters | Visible entries change correctly |
| `TC-069` | shared | regression | base | Toggle timestamps | Timestamps show/hide |
| `TC-070` | shared | regression | base | Click clear console | Console becomes empty |
| `TC-071` | shared | regression | base with JS/TS/Python | Inspect result panel | Inline results align with editor lines |
| `TC-072` | shared | regression | base with compiled language output | Inspect result panel | Full output view renders |
| `TC-073` | shared | regression | base with `undefined` values | Toggle `undef` | Undefined results hide/show |
| `TC-074` | shared | regression | base with runtime error | Run failing code | Error is visible with line info if available |
| `TC-075` | shared | regression | base | Run code | Execution time appears |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-076` | web | language | `WEB_BASE` | Run JS hello world | Output is correct |
| `TC-077` | web | language | `WEB_BASE` | Run JS with multiple logs | Console shows all logs in order |
| `TC-078` | web | language | `WEB_BASE` | Run JS runtime error | Error renders without crashing shell |
| `TC-079` | web | language | `WEB_BASE` | Run JS infinite loop candidate | Loop protection stops execution as expected |
| `TC-080` | web | language | `WEB_BASE` | Run TS hello world | Output is correct |
| `TC-081` | web | language | `WEB_BASE` | Run TS type error case | Type/compile error is shown |
| `TC-082` | web | language | `WEB_BASE` | Run Python print | Output is correct |
| `TC-083` | web | language | `WEB_BASE` | Run Python syntax/runtime error | Error renders correctly |
| `TC-084` | web | language | `WEB_BASE` | Open Go/Rust in web | Explicit limitation or supported behavior is shown correctly |
| `TC-085` | electron | language | `DESKTOP_BASE` | Run JS hello world | Output is correct |
| `TC-086` | electron | language | `DESKTOP_BASE` | Run TS hello world | Output is correct |
| `TC-087` | electron | language | `DESKTOP_BASE` | Run Python hello world | Output is correct |
| `TC-088` | electron | language | `DESKTOP_BASE` | Run Go hello world | Compile and execution succeed |
| `TC-089` | electron | language | `DESKTOP_BASE` | Run Go compile error case | Compile error is visible |
| `TC-090` | electron | language | `DESKTOP_BASE` | Run Rust hello world | Compile and execution succeed |
| `TC-091` | electron | language | `DESKTOP_BASE` | Run Rust compile error case | Compile error is visible |

| ID | Target | Tags | Setup | Steps | Assertions |
|---|---|---|---|---|---|
| `TC-092` | web | responsive | `WEB_BASE` | Run on mobile viewport | Toolbar and overlays remain usable, no critical overflow |
| `TC-093` | web | responsive | `WEB_BASE` | Run on tablet viewport | Settings and snippets adapt layout correctly |
| `TC-094` | web | responsive | `WEB_BASE` | Run on wide desktop viewport | Shell and welcome state render without clipping |
| `TC-095` | electron | desktop-only | `DESKTOP_BASE` | Open then close app | No orphaned processes remain |
| `TC-096` | electron | desktop-only | `DESKTOP_BASE` | Reopen app after close | App starts cleanly again |
| `TC-097` | electron | desktop-only | `DESKTOP_BASE` | Trigger shortcuts `Cmd+B`, `Cmd+\\`, `Cmd+P`, `Cmd+Shift+P`, `Cmd+,`, `Cmd+Enter` | Correct shell actions run |
| `TC-098` | shared | regression | base | Reload app | Theme, layout, snippets, and editor settings persist |
| `TC-099` | shared | regression | base | No project and no tabs | Empty state and CTAs are correct |
| `TC-100` | shared | smoke | base | End of suite cleanup | No blocking console errors and no zombie process left |

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
