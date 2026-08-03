import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildArtifactCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    onExportLatestCapsule,
    latestCapsuleAvailable = false,
    onOpenCapsuleImport,
    onBrowseCapsules,
    onOpenImportOverlay,
    onExportProjectBundle,
    onImportProjectBundle,
    onOpenRecipes,
    onNewNotebook,
    onExportActiveNotebookLinguanb,
    onShowLanguageSupport,
    onCopyLanguageScorecardMarkdown,
    onCopyBootTimings,
    onCopyShareLink,
    onReplayOnboardingWelcome,
    onReplayOnboardingFirstRun,
    onReplayOnboardingFirstSnippet,
    onShowPrivacyDashboard,
    onShowDependencies,
    onToggleOutputSourceMapping,
    onClose,
  } = args;

  const commands: CommandEntry[] = [
    // implementation note — Export latest run as capsule. Surfaces
    // only when the caller wires the handler AND the history store
    // confirms at least one entry still carries a `lastCapsule`. Hiding
    // the entry when no capsule exists keeps the palette honest about
    // what the action would do.
    ...(onExportLatestCapsule && latestCapsuleAvailable
      ? [
          buildActionCommand(
            'action-export-capsule',
            translate('commandPalette.action.exportCapsule.label'),
            translate('commandPalette.action.exportCapsule.description'),
            ['capsule', 'export', 'run', 'share', 'json', 'replay'],
            () => {
              onExportLatestCapsule();
              onClose();
            }
          ),
        ]
      : []),
    // implementation — Import capsule from JSON. Surfaces only when
    // App.tsx wires the AppOverlay branch. Always available (no
    // history precondition) so the user can import even when their
    // own session has no runs yet — a fresh user pasting a capsule
    // shared by a teammate is the primary motion.
    ...(onOpenCapsuleImport
      ? [
          buildActionCommand(
            'action-import-capsule',
            translate('commandPalette.action.importCapsule.label'),
            translate('commandPalette.action.importCapsule.description'),
            [
              'capsule',
              'import',
              'open',
              'paste',
              'json',
              'replay',
              'cargar',
              'capsula',
              'cápsula',
            ],
            () => {
              onClose();
              onOpenCapsuleImport();
            }
          ),
        ]
      : []),
    // implementation — Browse run capsules. Surfaces whenever App.tsx
    // wires the AppOverlay branch, with no history precondition: a
    // Free user must be able to discover the surface and hit the
    // upsell, and a Pro user with an empty session sees the empty
    // state. The overlay owns the Pro-gating.
    ...(onBrowseCapsules
      ? [
          buildActionCommand(
            'action-browse-capsules',
            translate('commandPalette.action.browseCapsules.label'),
            translate('commandPalette.action.browseCapsules.description'),
            [
              'capsule',
              'browse',
              'list',
              'history',
              'export',
              'preview',
              'explorar',
              'capsula',
              'cápsula',
            ],
            () => {
              onClose();
              onBrowseCapsules();
            }
          ),
        ]
      : []),
    // implementation note — Compare two capsules. Gated on the SAME
    // `onBrowseCapsules` handler: the comparator selection lives inline
    // in the capsule browser (per-row checkboxes + a Compare button), so
    // this command just opens that overlay where the user picks the pair.
    // No separate "compare mode" plumbing is needed. `onClose()` MUST run
    // before `onBrowseCapsules()` (same overlay-survival ordering as
    // `action-browse-capsules`): both set the single App `overlay` slot,
    // and within one React event handler the last setState wins — closing
    // the palette first lets the capsule-list overlay survive.
    ...(onBrowseCapsules
      ? [
          buildActionCommand(
            'action-compare-capsules',
            translate('command.compareCapsules'),
            translate('command.compareCapsules.description'),
            [
              'capsule',
              'compare',
              'diff',
              'side by side',
              'two',
              'comparar',
              'capsula',
              'cápsula',
              'comparación',
            ],
            () => {
              onClose();
              onBrowseCapsules();
            }
          ),
        ]
      : []),
    // implementation — open the global Import overlay. Mirror of the
    // capsule-import wiring above. Surfaces only when App.tsx wires
    // the AppOverlay branch; the `Mod+Alt+I` shortcut hits the same
    // path via `useGlobalShortcuts.openImportOverlay`.
    ...(onOpenImportOverlay
      ? [
          buildActionCommand(
            'action-open-import-overlay',
            translate('commandPalette.action.openImport.label'),
            translate('commandPalette.action.openImport.description'),
            ['import', 'curl', 'paste', 'drop', 'bring in', 'importar', 'pegar'],
            () => {
              onClose();
              onOpenImportOverlay();
            }
          ),
        ]
      : []),
    // implementation — export the open project as a `.zip` bundle. Same
    // create path as the FileTree button + `Mod+Alt+E`. Direct action
    // (no overlay); `onClose` first so the palette dismisses before the
    // save dialog opens.
    ...(onExportProjectBundle
      ? [
          buildActionCommand(
            'action-export-project-bundle',
            translate('commandPalette.action.exportProjectBundle.label'),
            translate('commandPalette.action.exportProjectBundle.description'),
            ['export', 'zip', 'bundle', 'project', 'download', 'archive', 'exportar', 'proyecto'],
            () => {
              onClose();
              onExportProjectBundle();
            }
          ),
        ]
      : []),
    // implementation — open the bundle import overlay. Mirror of the
    // capsule-import wiring; App.tsx opens the `project-bundle-import`
    // AppOverlay branch.
    ...(onImportProjectBundle
      ? [
          buildActionCommand(
            'action-import-project-bundle',
            translate('commandPalette.action.importProjectBundle.label'),
            translate('commandPalette.action.importProjectBundle.description'),
            ['import', 'zip', 'bundle', 'project', 'extract', 'unzip', 'importar', 'proyecto'],
            () => {
              onClose();
              onImportProjectBundle();
            }
          ),
        ]
      : []),
    // implementation Slice B implementation note — open the global Recipes overlay. Hits
    // the same path as `Mod+Alt+L`. `onClose` first so the palette
    // dismisses before the recipes overlay opens (single-event-loop
    // batch order, mirror of the import overlay entry above).
    ...(onOpenRecipes
      ? [
          buildActionCommand(
            'action-open-recipes',
            translate('commandPalette.action.openRecipes.label'),
            translate('commandPalette.action.openRecipes.description'),
            [
              'recipe',
              'lesson',
              'practice',
              'tutorial',
              'library',
              'receta',
              'leccion',
              'lección',
              'práctica',
            ],
            () => {
              onClose();
              onOpenRecipes();
            }
          ),
        ]
      : []),
    // implementation Slice A implementation note — create a fresh notebook tab. Mirror of
    // the recipes overlay wiring above; `onClose` runs before the
    // callback so the palette dismisses cleanly before the new tab
    // takes focus.
    ...(onNewNotebook
      ? [
          buildActionCommand(
            'action-new-notebook',
            translate('commandPalette.action.newNotebook.label'),
            translate('commandPalette.action.newNotebook.description'),
            ['notebook', 'cell', 'jupyter', 'new', 'cuaderno', 'nuevo'],
            () => {
              onClose();
              onNewNotebook();
            }
          ),
        ]
      : []),
    // implementation Slice E implementation note — export the active notebook as a native
    // lossless `.linguanb` document, the palette twin of the toolbar
    // export menu so it is reachable without the notebook toolbar.
    ...(onExportActiveNotebookLinguanb
      ? [
          buildActionCommand(
            'action-export-notebook-linguanb',
            translate('commandPalette.action.exportNotebookLinguanb.label'),
            translate('commandPalette.action.exportNotebookLinguanb.description'),
            ['notebook', 'export', 'linguanb', 'save', 'cuaderno', 'exporta', 'guardar'],
            () => {
              onClose();
              onExportActiveNotebookLinguanb();
            }
          ),
        ]
      : []),
    // implementation note — opens Settings on the Languages tab and
    // scrolls to the scorecard. `onClose()` MUST run before the user
    // callback: both helpers set the single `overlay` slot in App
    // state, and within one React event handler the last setState
    // call wins the batch. Closing the palette first and opening
    // Settings second matches the established pattern in
    // `action-settings` / `action-about` so the new overlay survives.
    ...(onShowLanguageSupport
      ? [
          buildActionCommand(
            'action-show-language-support',
            translate('commandPalette.action.showLanguageSupport.label'),
            translate('commandPalette.action.showLanguageSupport.description'),
            ['language', 'support', 'scorecard', 'matrix', 'lenguajes'],
            () => {
              onClose();
              onShowLanguageSupport();
            }
          ),
        ]
      : []),
    // implementation note — copies the markdown rendering of the
    // scorecard so users can paste into issues / PRs / docs.
    ...(onCopyLanguageScorecardMarkdown
      ? [
          buildActionCommand(
            'action-copy-language-scorecard-markdown',
            translate('commandPalette.action.copyLanguageScorecardMarkdown.label'),
            translate('commandPalette.action.copyLanguageScorecardMarkdown.description'),
            ['language', 'scorecard', 'markdown', 'copy', 'lenguajes', 'tabla'],
            () => {
              onCopyLanguageScorecardMarkdown();
              onClose();
            }
          ),
        ]
      : []),
    ...(onCopyBootTimings
      ? [
          buildActionCommand(
            'action-copy-boot-timings',
            translate('commandPalette.action.copyBootTimings.label'),
            translate('commandPalette.action.copyBootTimings.description'),
            ['boot', 'startup', 'performance', 'timings', 'arranque', 'rendimiento'],
            () => {
              onCopyBootTimings();
              onClose();
            }
          ),
        ]
      : []),
    // implementation Phase A1 implementation note — copies a share-link URL fragment that
    // recreates the active tab. The user callback may surface the
    // confirmation modal (implementation note); we close the palette FIRST so
    // both overlays don't compete for the same App state slot
    // (same overlay-survival pattern as `action-settings`).
    ...(onCopyShareLink
      ? [
          buildActionCommand(
            'action-copy-share-link',
            translate('commandPalette.action.copyShareLink.label'),
            translate('commandPalette.action.copyShareLink.description'),
            ['share', 'link', 'url', 'compartir', 'enlace', 'copy', 'copia'],
            () => {
              onClose();
              onCopyShareLink();
            }
          ),
        ]
      : []),
    // implementation note — three palette entries, one per stage.
    // Each closes the palette FIRST, then runs the reset callback so
    // any follow-up status notice the renderer emits doesn't compete
    // with the palette overlay for the same App state slot.
    ...(onReplayOnboardingWelcome
      ? [
          buildActionCommand(
            'action-replay-onboarding-welcome',
            translate('onboarding.palette.rearmWelcome.label'),
            translate('onboarding.palette.rearmWelcome.description'),
            ['onboarding', 'welcome', 'inicio', 'guiado', 'replay', 'reset'],
            () => {
              onClose();
              onReplayOnboardingWelcome();
            }
          ),
        ]
      : []),
    ...(onReplayOnboardingFirstRun
      ? [
          buildActionCommand(
            'action-replay-onboarding-first-run',
            translate('onboarding.palette.rearmFirstRun.label'),
            translate('onboarding.palette.rearmFirstRun.description'),
            ['onboarding', 'first', 'run', 'tip', 'rearm', 'reset'],
            () => {
              onClose();
              onReplayOnboardingFirstRun();
            }
          ),
        ]
      : []),
    ...(onReplayOnboardingFirstSnippet
      ? [
          buildActionCommand(
            'action-replay-onboarding-first-snippet',
            translate('onboarding.palette.rearmFirstSnippet.label'),
            translate('onboarding.palette.rearmFirstSnippet.description'),
            ['onboarding', 'first', 'snippet', 'tip', 'rearm', 'reset'],
            () => {
              onClose();
              onReplayOnboardingFirstSnippet();
            }
          ),
        ]
      : []),
    // implementation note — palette entry that opens Settings on
    // the Privacy tab. Closes the palette FIRST so the Settings
    // overlay isn't competing with it for the App state slot. Same
    // overlay-survival pattern as `action-settings` and
    // `action-show-language-support`.
    ...(onShowPrivacyDashboard
      ? [
          buildActionCommand(
            'action-show-privacy-dashboard',
            translate('commandPalette.action.showPrivacyDashboard.label'),
            translate('commandPalette.action.showPrivacyDashboard.description'),
            [
              'privacy',
              'privacidad',
              'trust',
              'confianza',
              'redaction',
              'redaccion',
              'audit',
              'auditoria',
              'network',
              'red',
            ],
            () => {
              onClose();
              onShowPrivacyDashboard();
            }
          ),
        ]
      : []),
    // implementation Slice A implementation note — opens the bottom-panel Dependencies
    // tab for the active file. Mirrors the `action-show-*` overlay
    // ordering: close the palette FIRST so the tab activation does
    // not compete with the palette overlay for the App state slot.
    ...(onShowDependencies
      ? [
          buildActionCommand(
            'action-show-dependencies',
            translate('commandPalette.action.showDependencies.label'),
            translate('commandPalette.action.showDependencies.description'),
            [
              'dependencies',
              'dependencias',
              'imports',
              'requires',
              'modules',
              'paquetes',
              'npm',
              'pip',
            ],
            () => {
              onClose();
              onShowDependencies();
            }
          ),
        ]
      : []),
    // implementation Sub-slice G implementation note — flips the master toggle for the
    // output→source line affordance. Keyword set covers EN + ES so
    // the palette finds it under "line badge", "output", "mapeo",
    // "origen", "chip" without forcing memorisation.
    ...(onToggleOutputSourceMapping
      ? [
          buildActionCommand(
            'action-toggle-output-source-mapping',
            translate('commandPalette.action.toggleOutputSourceMapping.label'),
            translate('commandPalette.action.toggleOutputSourceMapping.description'),
            [
              'output',
              'source',
              'origin',
              'line',
              'badge',
              'chip',
              'mapeo',
              'origen',
              'salida',
              'console',
              'consola',
            ],
            () => {
              onClose();
              onToggleOutputSourceMapping();
            }
          ),
        ]
      : []),
  ];

  return commands;
};
