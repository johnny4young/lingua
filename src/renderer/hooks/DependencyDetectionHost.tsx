import { useEffect, useState, type ComponentType } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

type RuntimeModule = typeof import('./DependencyDetectionHookRuntime');
let runtimePromise: Promise<RuntimeModule> | null = null;

function loadRuntime(): Promise<RuntimeModule> {
  runtimePromise ??= import('./DependencyDetectionHookRuntime').catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Keep dependency classification out of the first-render import graph.
 *
 * The runtime activates after the browser's first idle opportunity (bounded by
 * one second). Once activated it stays mounted so disabling the preference can
 * run the hook's privacy cleanup and re-enabling remains instantaneous.
 */
export function DependencyDetectionHost() {
  const enabled = useSettingsStore(state => state.dependencyDetectionEnabled);
  const [activated, setActivated] = useState(false);
  const [Runtime, setRuntime] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!enabled || activated) return;

    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(
        () => setActivated(true),
        { timeout: 1_000 }
      );
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(() => setActivated(true), 0);
    return () => window.clearTimeout(handle);
  }, [activated, enabled]);

  useEffect(() => {
    if (!activated || !enabled || Runtime) return;

    let active = true;
    void loadRuntime()
      .then(module => {
        if (active) setRuntime(() => module.default);
      })
      .catch(() => {
        // Detection is an enhancement, not a shell dependency. Keep the app
        // usable after a transient chunk failure; remounting or re-enabling
        // the preference retries the evicted import promise.
      });
    return () => {
      active = false;
    };
  }, [activated, enabled, Runtime]);

  return Runtime ? <Runtime /> : null;
}
