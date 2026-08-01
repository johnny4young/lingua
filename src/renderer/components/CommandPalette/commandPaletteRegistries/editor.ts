import { isJavaScriptFamily, isWorkerRunnerLanguage } from '../../../../shared/languageFamilies';
import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildEditorCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    onAddWatchToCurrentLine,
    activeWatchLanguage = null,
    onFocusStdinPanel,
    stdinPanelAvailable = false,
    onToggleAutoLogOnActiveTab,
    activeAutoLogResolved = false,
    onSetActiveLanguageTimeoutPreset,
    activeTimeoutLanguage = null,
    activeTimeoutPreset = null,
    onRunWithExtendedTimeout,
    onToggleCompareWithSnapshot,
    activeCompareEnabled = false,
    compareSnapshotAvailable = false,
    onToggleVariableInspector,
    activeVariableInspectorEnabled = false,
    variableInspectorScopeAvailable = false,
    onToggleVimMode,
    vimModeEnabled = false,
    onToggleInlineLint,
    inlineLintActiveIssueCount = 0,
    onPastePlainText,
    onToggleStatusBar,
    onBenchmarkActiveTab,
    onInstallNativeDependencies,
    onExplainLastError,
    onExplainSelectedCode,
    onFocusStatusBar,
    onTogglePresenterMode,
    setLayoutPreset,
    onOpenSnippets,
    onSetRuntimeMode,
    activeRuntimeMode = null,
    onClose,
  } = args;

  const commands: CommandEntry[] = [
    // implementation note — "Pin watch on current line". Only
    // surfaces when the caller wires `onAddWatchToCurrentLine`
    // AND the active tab's language supports `@watch` (JS / TS /
    // Python). For other languages the action is hidden entirely
    // so the palette stays honest about what's possible.
    ...(onAddWatchToCurrentLine && isWorkerRunnerLanguage(activeWatchLanguage)
      ? [
          buildActionCommand(
            'action-add-watch',
            translate('commandPalette.action.addWatch.label'),
            translate('commandPalette.action.addWatch.description'),
            ['watch', 'pin', 'magic', 'comment', 'inline', 'expression'],
            () => {
              onAddWatchToCurrentLine();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — focus the Input bottom-panel tab from
    // the command palette. Hidden when the master toggle is OFF or
    // when the active tab's language doesn't support stdin.
    ...(onFocusStdinPanel && stdinPanelAvailable
      ? [
          buildActionCommand(
            'action-focus-stdin-panel',
            translate('commandPalette.action.toggleStdin.label'),
            translate('commandPalette.action.toggleStdin.shown'),
            ['stdin', 'input', 'panel', 'prompt', 'readline'],
            () => {
              onFocusStdinPanel();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — toggle auto-log on the active tab.
    // Only surfaces for JS / TS active tabs; non-JS/TS tabs hide
    // the entry entirely so the palette never advertises an action
    // it would refuse. Reuses the per-tab override path so the
    // toggle is scoped to one tab, not the global Settings default.
    ...(onToggleAutoLogOnActiveTab && isJavaScriptFamily(activeWatchLanguage)
      ? [
          buildActionCommand(
            'action-toggle-auto-log',
            translate('commandPalette.action.toggleAutoLog.label'),
            translate(
              activeAutoLogResolved
                ? 'commandPalette.action.toggleAutoLog.enabled'
                : 'commandPalette.action.toggleAutoLog.disabled'
            ),
            ['auto-log', 'autolog', 'inline', 'expression', 'scratchpad', 'toggle'],
            () => {
              onToggleAutoLogOnActiveTab();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — "Set execution timeout: Quick / Normal /
    // Long / Extended" entries on the active language. Hidden when
    // the active language isn't in the supported set or when the
    // caller didn't wire `onSetActiveLanguageTimeoutPreset`. Active
    // preset is suffixed with " · current" so the user sees which is
    // selected without having to reach for Settings.
    ...(onSetActiveLanguageTimeoutPreset && activeTimeoutLanguage
      ? (['quick', 'normal', 'long', 'extended'] as const).map(preset =>
          buildActionCommand(
            `action-set-timeout-${preset}`,
            translate(`commandPalette.action.setTimeout.${preset}.label`),
            preset === activeTimeoutPreset
              ? translate('commandPalette.action.setTimeout.activeDescription')
              : translate(`commandPalette.action.setTimeout.${preset}.description`),
            ['timeout', 'preset', 'execution', 'run', 'limit', 'deadline', preset],
            () => {
              onSetActiveLanguageTimeoutPreset(preset);
              onClose();
            }
          )
        )
      : []),
    // implementation note — one-shot "Run with extended timeout".
    // Sets `nextRunTimeoutOverrideMs` on the active tab and
    // dispatches the run; the override is consumed once. Hidden when
    // the caller did not wire the handler or the active language is
    // outside the timeout-preset supported set.
    ...(onRunWithExtendedTimeout && activeTimeoutLanguage
      ? [
          buildActionCommand(
            'action-run-with-extended-timeout',
            translate('commandPalette.action.runExtendedTimeout.label'),
            translate('commandPalette.action.runExtendedTimeout.description'),
            ['run', 'extended', 'timeout', 'long', 'once', 'override'],
            () => {
              onRunWithExtendedTimeout();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — toggle the Compare panel on the
    // active tab. Hidden when there's no comparator snapshot for
    // the active language (matches the toggle-button gate). The
    // description flips between "Show" and "Hide" so the palette
    // honestly previews the next state.
    ...(onToggleCompareWithSnapshot && compareSnapshotAvailable
      ? [
          buildActionCommand(
            'action-toggle-compare-with-snapshot',
            translate('commandPalette.action.toggleCompare.label'),
            translate(
              activeCompareEnabled
                ? 'commandPalette.action.toggleCompare.descriptionHide'
                : 'commandPalette.action.toggleCompare.descriptionShow'
            ),
            ['compare', 'diff', 'snapshot', 'stable', 'previous', 'toggle'],
            () => {
              onToggleCompareWithSnapshot();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — toggle the variable inspector on the
    // active tab. Hidden when there's no scope snapshot for the
    // active language (matches the toggle-button gate). Description
    // flips between Show / Hide.
    ...(onToggleVariableInspector && variableInspectorScopeAvailable
      ? [
          buildActionCommand(
            'action-toggle-variable-inspector',
            translate('commandPalette.action.toggleVariableInspector.label'),
            translate(
              activeVariableInspectorEnabled
                ? 'commandPalette.action.toggleVariableInspector.descriptionHide'
                : 'commandPalette.action.toggleVariableInspector.descriptionShow'
            ),
            ['variables', 'inspector', 'scope', 'last', 'run', 'toggle'],
            () => {
              onToggleVariableInspector();
              onClose();
            }
          ),
        ]
      : []),
    // implementation reviewer pass — the rich-console toggle was removed
    // from the catalog: `consoleRichRenderingEnabled` is no longer a
    // Settings preference, rich rendering is baseline.
    // implementation — Toggle Vim mode. Hidden when the caller does
    // not wire `onToggleVimMode`; description text flips based on
    // `vimModeEnabled` so the palette honestly previews the next state.
    ...(onToggleVimMode
      ? [
          buildActionCommand(
            'action-toggle-vim-mode',
            translate('commandPalette.toggleVimMode.label'),
            translate(
              vimModeEnabled
                ? 'commandPalette.toggleVimMode.descriptionDisable'
                : 'commandPalette.toggleVimMode.descriptionEnable'
            ),
            ['vim', 'mode', 'keybindings', 'editor', 'toggle'],
            () => {
              onToggleVimMode();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — toggle inline lint for the active language. Surfaced
    // only when the caller wires it (i.e. the active tab is a lintable JS/TS
    // language).
    ...(onToggleInlineLint
      ? [
          buildActionCommand(
            'action-toggle-inline-lint',
            translate('commandPalette.action.toggleInlineLint.label'),
            // implementation — when the active JS/TS buffer has custom-lint
            // issues, preview the count so the palette surfaces "there are N
            // things to fix here" without opening the editor gutter.
            inlineLintActiveIssueCount > 0
              ? translate('commandPalette.action.toggleInlineLint.descriptionWithCount', {
                  count: inlineLintActiveIssueCount,
                })
              : translate('commandPalette.action.toggleInlineLint.description'),
            ['lint', 'inline', 'diagnostics', 'squiggle', 'editor', 'toggle'],
            () => {
              onToggleInlineLint();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — "Paste as plain text", the discoverable twin of the
    // editor's Cmd+Shift+V bypass. Surfaced only when the caller wires it
    // (an editor is active). Closes the palette first, then pastes.
    ...(onPastePlainText
      ? [
          buildActionCommand(
            'action-paste-plain-text',
            translate('commandPalette.action.pastePlainText.label'),
            translate('commandPalette.action.pastePlainText.description'),
            ['paste', 'plain', 'text', 'raw', 'literal', 'smart', 'bypass', 'pegar', 'texto'],
            () => {
              onClose();
              onPastePlainText();
            }
          ),
        ]
      : []),
    // implementation — toggle the persistent status bar. Hidden when the
    // caller does not wire `onToggleStatusBar` so legacy callers keep working.
    ...(onToggleStatusBar
      ? [
          buildActionCommand(
            'action-toggle-status-bar',
            translate('command.toggleStatusBar'),
            translate('command.toggleStatusBar'),
            ['status', 'bar', 'toggle', 'show', 'hide', 'estado', 'barra', 'cursor', 'lint'],
            () => {
              onToggleStatusBar();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — benchmark the active tab. Wired only when the tab is a
    // worker-runner language AND the tier holds `BENCHMARK`, so the entry
    // stays hidden otherwise.
    ...(onBenchmarkActiveTab
      ? [
          buildActionCommand(
            'action-benchmark-tab',
            translate('command.benchmark'),
            translate('command.benchmarkDescription'),
            [
              'benchmark',
              'profile',
              'perf',
              'performance',
              'timing',
              'speed',
              'medir',
              'rendimiento',
            ],
            () => {
              onBenchmarkActiveTab();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — install detected Go/Rust/Ruby packages for the active tab.
    ...(onInstallNativeDependencies
      ? [
          buildActionCommand(
            'action-install-native-deps',
            translate('command.installNativeDeps'),
            translate('command.installNativeDepsDescription'),
            [
              'install',
              'dependencies',
              'packages',
              'go',
              'rust',
              'ruby',
              'gem',
              'crate',
              'module',
              'instalar',
            ],
            () => {
              onInstallNativeDependencies();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — explain the last run error. Wired only when there is an error
    // to explain AND the tier holds LOCAL_AI.
    ...(onExplainLastError
      ? [
          buildActionCommand(
            'action-explain-last-error',
            translate('command.explainError'),
            translate('command.explainErrorDescription'),
            ['explain', 'error', 'why', 'fix', 'diagnose', 'explicar', 'error', 'ayuda'],
            () => {
              onExplainLastError();
              onClose();
            }
          ),
        ]
      : []),
    // internal  — explain the current selection / buffer with the
    // local AI model. Wired only when LOCAL_AI is held and an editor is
    // active.
    ...(onExplainSelectedCode
      ? [
          buildActionCommand(
            'action-explain-selected-code',
            translate('command.explainCode'),
            translate('command.explainCodeDescription'),
            [
              'explain',
              'code',
              'ai',
              'describe',
              'selection',
              'explicar',
              'código',
              'ia',
              'selección',
            ],
            () => {
              onExplainSelectedCode();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — focus the status bar's first segment. Surfaced only
    // when wired AND the bar is visible (the caller gates on `showStatusBar`).
    ...(onFocusStatusBar
      ? [
          buildActionCommand(
            'action-focus-status-bar',
            translate('command.focusStatusBar'),
            translate('command.focusStatusBar'),
            ['status', 'bar', 'focus', 'keyboard', 'estado', 'barra', 'enfocar'],
            () => {
              onFocusStatusBar();
              onClose();
            }
          ),
        ]
      : []),
    ...(onTogglePresenterMode
      ? [
          buildActionCommand(
            'action-toggle-presenter-mode',
            translate('commandPalette.action.presenterMode.label'),
            translate('commandPalette.action.presenterMode.description'),
            ['presenter', 'focus', 'zen', 'demo', 'present', 'chrome'],
            () => {
              onTogglePresenterMode();
              onClose();
            }
          ),
        ]
      : []),
    buildActionCommand(
      'action-layout-horizontal',
      translate('commandPalette.action.layout.horizontal.label'),
      translate('commandPalette.action.layout.horizontal.description'),
      ['layout', 'horizontal', 'split', 'console'],
      () => {
        setLayoutPreset('horizontal');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-vertical',
      translate('commandPalette.action.layout.vertical.label'),
      translate('commandPalette.action.layout.vertical.description'),
      ['layout', 'vertical', 'split'],
      () => {
        setLayoutPreset('vertical');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-editor',
      translate('commandPalette.action.layout.editorOnly.label'),
      translate('commandPalette.action.layout.editorOnly.description'),
      ['layout', 'editor', 'only', 'hide', 'console'],
      () => {
        setLayoutPreset('editor-only');
        onClose();
      }
    ),
    buildActionCommand(
      'action-snippets',
      translate('commandPalette.action.snippets.label'),
      translate('commandPalette.action.snippets.description'),
      ['snippets', 'snippet', 'library', 'save snippet'],
      () => {
        onClose();
        onOpenSnippets();
      }
    ),
    // implementation note — Switch runtime to {Worker | Node |
    // Browser preview}. Only emitted when the caller wires
    // `onSetRuntimeMode` AND the active tab actually owns the
    // runtime-mode surface (JS/TS today, signalled by a non-null
    // `activeRuntimeMode`). `setTabRuntimeMode` remains the guard
    // for any future unimplemented mode.
    ...(onSetRuntimeMode && activeRuntimeMode !== null
      ? ([
          buildActionCommand(
            'action-runtime-mode-worker',
            translate('commandPalette.action.runtimeMode.worker.label'),
            translate('commandPalette.action.runtimeMode.worker.description'),
            ['runtime', 'mode', 'worker', 'sandbox', 'js', 'ts'],
            () => {
              onSetRuntimeMode('worker');
              onClose();
            }
          ),
          buildActionCommand(
            'action-runtime-mode-node',
            translate('commandPalette.action.runtimeMode.node.label'),
            translate('commandPalette.action.runtimeMode.node.description'),
            ['runtime', 'mode', 'node', 'desktop', 'fs', 'path'],
            () => {
              onSetRuntimeMode('node');
              onClose();
            }
          ),
          buildActionCommand(
            'action-runtime-mode-browser-preview',
            translate('commandPalette.action.runtimeMode.browserPreview.label'),
            translate('commandPalette.action.runtimeMode.browserPreview.description'),
            ['runtime', 'mode', 'browser', 'preview', 'iframe', 'dom'],
            () => {
              onSetRuntimeMode('browser-preview');
              onClose();
            }
          ),
          // implementation — Deno / Bun desktop runtimes.
          buildActionCommand(
            'action-runtime-mode-deno',
            translate('commandPalette.action.runtimeMode.deno.label'),
            translate('commandPalette.action.runtimeMode.deno.description'),
            ['runtime', 'mode', 'deno', 'desktop', 'ts', 'sandbox'],
            () => {
              onSetRuntimeMode('deno');
              onClose();
            }
          ),
          buildActionCommand(
            'action-runtime-mode-bun',
            translate('commandPalette.action.runtimeMode.bun.label'),
            translate('commandPalette.action.runtimeMode.bun.description'),
            ['runtime', 'mode', 'bun', 'desktop', 'ts', 'fast'],
            () => {
              onSetRuntimeMode('bun');
              onClose();
            }
          ),
        ] as CommandEntry[])
      : []),
  ];

  return commands;
};
