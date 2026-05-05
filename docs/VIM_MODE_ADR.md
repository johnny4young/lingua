# ADR — Vim mode integration (RL-037 personalization slice)

| Status | Accepted — Vim integration shipped on 2026-05-01 |
| ------ | ----------------- |
| Decision | Add an opt-in Vim keybindings layer via the `monaco-vim` package, lazy-loaded behind a single Settings toggle. Vim only hijacks keystrokes when the Monaco editor owns focus; global shortcuts (Quick Open, Command Palette) keep working elsewhere. |
| Date | 2026-04-20 |
| Implementation | Shipped on 2026-05-01 — `settings.vimMode` toggles the lazy `monaco-vim` layer, the localized status-bar subclass, safe `:w` / `:q` routing, and the macro smoke coverage. |

## Context

RL-037 "Add deep editor personalization" is partly shipped (keymap
presets, theme presets, custom shortcut editor) but Vim mode is the
last outstanding item. Monaco ships no built-in Vim layer, so the
decision is which third-party surface we wire in and how we reconcile
it with the global shortcuts the rest of the app already binds.

Three questions need a written answer before any code lands:

1. **Library.** `monaco-vim` vs. hand-rolled vs. the wider VSCodeVim
   port. Settle on one and document why.
2. **Focus + keystroke ownership.** Vim modes hijack single-letter
   keys in normal mode (`h`, `j`, `d`, `y`, `:`). Lingua already binds
   global shortcuts (`Ctrl/Cmd+P` Quick Open, `Ctrl/Cmd+K` Command
   Palette, `Ctrl/Cmd+,` Settings). Decide where the boundary is.
3. **i18n posture.** `monaco-vim`'s status bar (`-- INSERT --`,
   `-- NORMAL --`) is English-only upstream. Decide whether we
   localize now, later, or never.

## Decisions

### 1. Library — `monaco-vim`

| Candidate | Verdict | Reason |
|-----------|---------|--------|
| `monaco-vim` | **Accepted** | Active upstream, small footprint (~60 kB min+gz), minimal API surface (`initVimMode(editor, statusBarNode)`), no React dependency, no Monaco fork. Used by several large Monaco-based editors in production. |
| Hand-rolled mode machine | Rejected | Re-implements a decade of Vim quirks for a single personalization toggle. Unbounded scope. |
| VSCodeVim port | Rejected | Targets VS Code's extension host and pulls in command infrastructure that does not exist in raw Monaco. Would require a substantial shim. |

`monaco-vim` is bundled **lazy** via a dynamic `import()` gated by
the `settings.vimMode` flag so the default payload is unchanged for
users who never flip it on.

### 2. Focus + keystroke ownership

- **Vim owns the editor surface only.** `initVimMode` is attached to
  the active Monaco instance; when focus is on the editor, Vim
  intercepts `h/j/k/l`, `i/a/o`, `:`, `/`, and the rest.
- **Global shortcuts stay global.** When focus is on the Tab bar,
  the file tree, the console, a modal, or anywhere outside Monaco,
  `Ctrl/Cmd+P`, `Ctrl/Cmd+K`, `Ctrl/Cmd+,`, etc. resolve exactly as
  today. The existing `useGlobalShortcuts` hook already gates on
  focus and is not modified by this slice.
- **`Ctrl/Cmd+P` conflict.** Vim binds `Ctrl+P` as "previous
  completion" in insert mode. Lingua globally binds `Ctrl/Cmd+P` to
  Quick Open. The conflict is narrow: a Vim user in **insert mode
  with editor focus** would hit Vim's binding. Decision: Vim's
  binding wins only inside the editor. The Command Palette and
  Quick Open remain reachable from any other focus target, and the
  user can remap Quick Open via the existing RL-057 custom shortcut
  editor if they prefer another combo when they're heavy into Vim.
- **`:q` closes the tab through the existing unsaved-changes guard.**
  Vim's `:q`, `:qa`, and `:wq` are wired to the same `closeTab` /
  `closeAllTabs` action used by the close buttons, so the dirty-tab
  prompt still fires; it is not a destructive override.
- **`:w` saves through the existing save pipeline.** Format-on-save,
  IPC formatters, and the renderer save telemetry event all still
  fire. Vim is a keybindings layer, not a replacement save path.

### 3. i18n posture

- The `monaco-vim` status bar emits strings like `-- INSERT --` and
  `-- NORMAL --`. Upstream does not localize these.
- **Decision:** ship a small localized status-bar subclass instead of
  forking `monaco-vim`. The adapter overrides upstream `setMode` and
  routes mode labels through i18n while leaving command input, key
  buffers, and notifications under the upstream implementation.
- This keeps the maintenance surface narrow: Lingua owns the six
  visible mode labels, and `monaco-vim` still owns editing behavior,
  command routing, macros, and disposal.

## Implementation sketch

- **Settings toggle.** `settings.vimMode: boolean` lands in
  `settingsStore` with default `false`. `EditorSection` renders the
  toggle under the existing "Editing behavior" group.
- **Editor bootstrap.** `CodeEditor` reads `settings.vimMode` and,
  when `true`, lazy-imports `monaco-vim` and calls `initVimMode`
  against the current editor. Disposes the returned handle on
  toggle-off and on editor unmount.
- **Status bar.** A new `VimStatusBar` component renders a `<div>`
  node the Vim layer writes into. Placed in the existing footer
  slot next to the Monaco position indicator. Hidden when
  `settings.vimMode === false`.
- **Persistence.** The toggle persists through the existing
  `settingsStore` persist middleware. No new storage key.

## Verification matrix (for the follow-up slice)

| Scenario | Expectation |
|----------|-------------|
| Toggle on → editor focus → `i` | Status bar shows `-- INSERT --`, typed characters reach the model |
| Toggle on → `Esc` → `:w` | Current tab saves through the normal save pipeline (format-on-save still fires) |
| Toggle on → `:q` on a dirty tab | Existing unsaved-changes dialog appears; `:q` does not force-discard |
| Toggle on → `/foo` | Monaco find widget opens with query `foo`; `n` / `N` advance as usual |
| Toggle on → focus the tab bar → `Ctrl/Cmd+P` | Quick Open opens (Vim did not hijack — focus is off the editor) |
| Toggle off | Vim layer disposed; all native Monaco keybindings restored; no leftover status bar node |

## Rollback

- Single Settings toggle inversion removes the feature at runtime.
- The dynamic import path means shipping `vimMode: false` as the
  default keeps the lazy chunk off the startup critical path — no
  release rollback needed to hide the feature.
- If a regression ships, the `monaco-vim` integration can be
  disabled code-side by force-returning `false` from the gate in
  `CodeEditor` while a fix lands. The store flag is safe to leave
  alone in that case because read-only.

## When to revisit

1. `monaco-vim` upstream stalls for more than 12 months and a fork
   with the fixes we need does not exist.
2. Lingua adopts a non-Monaco editor primitive (would require a
   fresh ADR regardless).
3. A localized Vim status bar becomes a shipping requirement (would
   require a follow-up ADR for the escape-hatch component).
4. A new global shortcut conflicts with a Vim binding in a way that
   the focus rule above cannot reconcile cleanly.
5. The lazy chunk exceeds 150 kB gzipped — revisit whether a Vim
   subset (movement + ex commands only) is a better fit.

## Adjacent ADRs

- `BUILD_SYSTEM_ADR.md` — governs the bundler choices that the lazy
  import path depends on.
- `LANGUAGE_PACK_ADR.md` — the CodeEditor language plumbing the
  Vim layer attaches to. Slice B already unified runner dispatch;
  Vim mode is language-agnostic.
- `CAPABILITY_MATRIX.md` — Vim mode is a renderer-only
  personalization layer. Capability matrix is unaffected.
- `README.md` — cross-links this ADR in the "Decisions and ADRs"
  section.

## Cross-links

- RL-037 in `PLAN.md` — this ADR flips the Vim-mode portion of that
  item to "design accepted".
- RL-057 (custom shortcut editor) in `PLAN.md` — referenced by the
  `Ctrl/Cmd+P` conflict resolution.
