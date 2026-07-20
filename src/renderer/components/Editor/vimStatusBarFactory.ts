/**
 * internal Vim mode integration — factory for a localized status bar
 * subclass. `monaco-vim` ships an English-only `VimStatusBar` whose
 * `setMode({ mode, subMode })` calls `setText('--INSERT--')` etc.
 * We subclass it and replace `setMode` with a translator-backed
 * version so the visible mode text follows the active locale.
 *
 * The factory takes the bound `t` from `useTranslation()` so the
 * subclass closes over the live translator. It returns a `StatusBarCtor`
 * compatible with `initVimMode(editor, node, StatusBarClass)`.
 *
 * Other status-bar surfaces (`setSec` for `:` ex-command input,
 * `setKeyBuffer` for `dd`/`yy` partials, `showNotification`) carry
 * literal user input or short transient strings; we do not localize
 * them.
 */

import type { StatusBar as VimStatusBar } from 'monaco-vim';

type StatusBarCtor = typeof VimStatusBar;
type Translator = (key: string, options?: Record<string, string | number>) => string;

interface VimModeChangeEvent {
  mode: string;
  subMode?: string;
}

export function createLocalizedStatusBarClass(
  Base: StatusBarCtor,
  t: Translator
): StatusBarCtor {
  class LocalizedVimStatusBar extends (Base as unknown as new (
    ...args: ConstructorParameters<StatusBarCtor>
  ) => InstanceType<StatusBarCtor>) {
    setMode(ev: VimModeChangeEvent): void {
      const text = resolveModeText(ev, t);
      // Reuse the upstream `setText` so the same `modeInfoNode` element
      // receives the localized string. Casting to access the inherited
      // method through the typed-as-`any` superclass facade.
      (this as unknown as { setText(text: string): void }).setText(text);
    }
  }

  return LocalizedVimStatusBar as unknown as StatusBarCtor;
}

function resolveModeText(ev: VimModeChangeEvent, t: Translator): string {
  if (ev.mode === 'visual') {
    if (ev.subMode === 'linewise') {
      return t('editor.vimMode.statusBar.visualLine');
    }
    if (ev.subMode === 'blockwise') {
      return t('editor.vimMode.statusBar.visualBlock');
    }
    return t('editor.vimMode.statusBar.visual');
  }
  if (ev.mode === 'insert') return t('editor.vimMode.statusBar.insert');
  if (ev.mode === 'replace') return t('editor.vimMode.statusBar.replace');
  // Default — covers `normal` and any future mode the upstream
  // library introduces. The upstream fallback is `--<MODE>--` upper-cased;
  // ours falls through to the localized `normal` string so no English
  // ever leaks into the bar at runtime.
  return t('editor.vimMode.statusBar.normal');
}
