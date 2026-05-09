import { useEffect } from 'react';
import {
  useUtilityOutputStore,
  type UtilityApplyHandler,
  type UtilityOutputProvider,
} from '../stores/utilityOutputStore';

/**
 * RL-069 Slice 1 — Per-panel registration helper.
 *
 * A utility panel calls `useRegisterUtilityOutput(() => output)` to
 * advertise its current output to the global Cmd+Shift+C / Cmd+Alt+R
 * shortcuts. We intentionally re-register on every render (the getter
 * captures the latest closure scope each time) so the shortcut hook
 * always reads the freshest output without per-keystroke effects.
 *
 * On unmount the registration is cleared so a stale getter from a
 * closed modal session never leaks across "user closes utilities,
 * presses Cmd+Shift+C in the editor" boundaries.
 *
 * React 18 Strict Mode note: the dev runtime double-invokes effects
 * (mount → cleanup → mount). The reference-equality guard below means
 * the cleanup pass clears the store, then the second mount re-installs
 * the same provider — final state matches a single-mount cycle, so no
 * extra ref-tracking is needed and production behaviour is unaffected.
 */
export function useRegisterUtilityOutput(provider: UtilityOutputProvider): void {
  useEffect(() => {
    useUtilityOutputStore.getState().setProvider(provider);
    return () => {
      // Only clear when our provider is still the active one — prevents
      // a "double-register, fast-unmount" race from clearing a sibling
      // panel that just took over.
      if (useUtilityOutputStore.getState().provider === provider) {
        useUtilityOutputStore.getState().clearProvider();
      }
    };
  }, [provider]);
}

/**
 * RL-069 Slice 2 — Per-panel registration helper for ⚡ Apply.
 *
 * Mirrors `useRegisterUtilityOutput` but registers an apply descriptor
 * resolver rather than an output provider. The Mod+Shift+A shortcut
 * reads through this getter at dispatch time so the descriptor is
 * always fresh — disabled state, current input shape, and the
 * imperative `run()` callback all reflect the latest render.
 *
 * Pure-generator panels (random-string, lorem-ipsum) skip this hook
 * entirely; the Apply shortcut surfaces a "no Apply registered" toast
 * when fired against them.
 */
export function useRegisterUtilityApply(handler: UtilityApplyHandler): void {
  useEffect(() => {
    useUtilityOutputStore.getState().setApplyHandler(handler);
    return () => {
      if (useUtilityOutputStore.getState().applyHandler === handler) {
        useUtilityOutputStore.getState().clearApplyHandler();
      }
    };
  }, [handler]);
}
