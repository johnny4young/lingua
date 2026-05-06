import { useEffect, useEffectEvent, useMemo } from 'react';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  matchesCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
  type ShortcutDefinition,
} from '../data/keyboardShortcuts';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useUtilityOutputStore } from '../stores/utilityOutputStore';

export type AppOverlay =
  | 'none'
  | 'settings'
  | 'palette'
  | 'quick-open'
  | 'search'
  | 'go-to-symbol'
  | 'utilities'
  | 'snippets'
  | 'whats-new'
  | 'keyboard-shortcuts';

interface UseGlobalShortcutsOptions {
  isRunning: boolean;
  run: () => void | Promise<void>;
  stop: () => void;
  saveActiveTab: () => void | Promise<void>;
  saveActiveTabAs: () => void | Promise<void>;
  openFileFromDisk: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  overlay: AppOverlay;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  openDeveloperUtilities: () => void;
  closeOverlay: () => void;
}

type ShortcutHandler = (event: KeyboardEvent) => void;

/**
 * Actions dispatched when a catalogued shortcut matches. Keeping this keyed
 * by the catalog's id (instead of hardcoded combo branches) is what lets
 * per-user overrides work without a second rebinding path. The Escape /
 * overlay-close case is handled separately because it has overlay-aware
 * gating that the generic matcher doesn't need to know about.
 */
function buildActionMap(options: UseGlobalShortcutsOptions): Record<string, ShortcutHandler> {
  const { run, stop, isRunning } = options;
  return {
    'run-toggle': () => {
      if (isRunning) stop();
      else void run();
    },
    'file-save': () => {
      void options.saveActiveTab();
    },
    'file-save-as': () => {
      void options.saveActiveTabAs();
    },
    'file-open': () => {
      void options.openFileFromDisk();
    },
    'file-close-tab': () => {
      void options.closeActiveTab();
    },
    'nav-quick-open': () => options.toggleOverlay('quick-open'),
    'nav-go-to-symbol': () => options.toggleOverlay('go-to-symbol'),
    'nav-project-search': () => options.toggleOverlay('search'),
    'overlay-command-palette': () => options.toggleOverlay('palette'),
    'overlay-settings': () => options.toggleOverlay('settings'),
    'overlay-developer-utilities': () => options.openDeveloperUtilities(),
    'view-toggle-sidebar': () => options.toggleSidebar(),
    'view-toggle-console': () => options.toggleConsole(),
    // RL-069 Slice 1 — Both shortcuts read the registered utility
    // panel output via `useUtilityOutputStore` and write to the
    // clipboard. Cmd+Alt+R semantically replaces the clipboard with
    // the output (same write call as Copy Output today; the toast key
    // signals intent to the user). Slice 2 will diverge them once
    // detect()-driven Apply enters the picture.
    'utility-copy-output': () => {
      void writeUtilityOutputToClipboard('copy');
    },
    'utility-replace-clipboard': () => {
      void writeUtilityOutputToClipboard('replace');
    },
  };
}

// RL-069 Slice 1 — module-level in-flight flag. The shortcut handler
// is fire-and-forget, so a fast double-press of Cmd+Shift+C while the
// previous navigator.clipboard.writeText is still pending would queue
// two independent toasts. Dropping the duplicate keeps the visual
// feedback honest. Module-level state is acceptable here because the
// helper is only invoked from the global shortcut handler — there is
// no concurrent caller surface.
let utilityClipboardInFlight = false;

function getShortcutLabel(shortcutId: string): string | undefined {
  const definition = KEYBOARD_SHORTCUTS.find((entry) => entry.id === shortcutId);
  if (!definition) return undefined;
  const combo = resolveCombos(
    definition,
    useSettingsStore.getState().shortcutOverrides
  )[0];
  if (!combo) return undefined;

  const runtimePlatform =
    typeof window !== 'undefined' ? window.lingua?.platform ?? 'web' : 'web';
  const navigatorPlatform =
    typeof navigator !== 'undefined' ? navigator.platform : undefined;
  const displayPlatform = resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
  return formatShortcutCombo(combo, displayPlatform);
}

async function writeUtilityOutputToClipboard(mode: 'copy' | 'replace'): Promise<void> {
  if (utilityClipboardInFlight) return;
  utilityClipboardInFlight = true;
  try {
    const provider = useUtilityOutputStore.getState().getProvider();
    const pushNotice = useUIStore.getState().pushStatusNotice;

    if (!provider) {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    const value = provider();
    if (value === null || value === '') {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      pushNotice({
        tone: 'success',
        messageKey:
          mode === 'replace'
            ? 'utilities.toast.replaceClipboardSuccess'
            : 'utilities.toast.copyOutputSuccess',
        values: {
          shortcut:
            getShortcutLabel(
              mode === 'replace' ? 'utility-replace-clipboard' : 'utility-copy-output'
            ) ?? '',
        },
      });
    } catch {
      pushNotice({ tone: 'error', messageKey: 'utilities.toast.copyOutputFailed' });
    }
  } finally {
    utilityClipboardInFlight = false;
  }
}

export function useGlobalShortcuts(options: UseGlobalShortcutsOptions) {
  const overrides = useSettingsStore((state) => state.shortcutOverrides);

  const dispatchable = useMemo<readonly ShortcutDefinition[]>(
    () => KEYBOARD_SHORTCUTS.filter((entry) => entry.id !== 'overlay-close'),
    []
  );

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Escape is handled separately so it only fires when an overlay is open,
    // which avoids stealing the key from text inputs elsewhere in the app.
    if (event.key === 'Escape') {
      if (options.overlay !== 'none') {
        event.preventDefault();
        options.closeOverlay();
      }
      return;
    }

    const actions = buildActionMap(options);
    for (const definition of dispatchable) {
      const combos = resolveCombos(definition, overrides);
      if (!combos.some((combo) => matchesCombo(event, combo))) continue;
      const action = actions[definition.id];
      if (!action) continue;
      event.preventDefault();
      action(event);
      return;
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleKeyDown]);
}
