import { forwardRef } from 'react';

/**
 * RL-037 Vim mode integration — host element for the `monaco-vim`
 * status bar. The Vim layer writes mode + key-buffer + ex-command
 * input nodes into this element via `initVimMode(editor, node, …)`.
 *
 * The localization piece is in `vimStatusBarFactory` (sibling file):
 * `monaco-vim`'s default `VimStatusBar` writes upstream English text
 * (`--INSERT--`, `--NORMAL--`); the factory subclasses it and
 * overrides `setMode` so the rendered text comes from i18n. We do
 * NOT localize `setSec` / `setKeyBuffer` — those surfaces show user
 * input (`:w`, `dd`) verbatim and have no language-bearing strings.
 *
 * The wrapper hides itself when `vimEnabled === false` so toggling
 * the feature off leaves no leftover footer node.
 */
interface VimStatusBarProps {
  vimEnabled: boolean;
}

export const VimStatusBar = forwardRef<HTMLDivElement, VimStatusBarProps>(
  function VimStatusBar({ vimEnabled }, ref) {
    return (
      <div
        ref={ref}
        data-testid="vim-status-bar"
        aria-hidden={!vimEnabled}
        className={
          vimEnabled
            ? 'flex items-center gap-3 border-t border-border/60 bg-surface-strong/40 px-3 py-1 font-mono text-caption text-muted'
            : 'hidden'
        }
      />
    );
  }
);
