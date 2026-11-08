import { useEffect } from 'react';
import { useNativeToolchainStore } from '../stores/nativeToolchainStore';
import { useUIStore } from '../stores/uiStore';
import {
  isNativeLanguageToolchain,
  type NativeLanguageToolchain,
} from '../utils/nativeLanguageToolchainStatus';

const consoleOpenedFor = new Set<NativeLanguageToolchain>();

/**
 * Probe Go or Rust when its tab is active on desktop and return it while the
 * binary is missing. The first miss of a session opens the Console, where the
 * empty state offers the way out.
 */
export function useMissingActiveToolchain(language: string): NativeLanguageToolchain | null {
  const isWeb = typeof window === 'undefined' || window.lingua?.platform === 'web';
  const id = !isWeb && isNativeLanguageToolchain(language) ? language : null;
  const status = useNativeToolchainStore(state => (id ? state[id].status : null));
  const missing = id && status === 'missing' ? id : null;

  useEffect(() => {
    if (id) void useNativeToolchainStore.getState().probe(id);
  }, [id]);

  useEffect(() => {
    if (!missing || consoleOpenedFor.has(missing)) return;
    consoleOpenedFor.add(missing);
    useUIStore.getState().openBottomPanel('console');
  }, [missing]);

  return missing;
}

export function resetMissingToolchainConsoleForTests(): void {
  consoleOpenedFor.clear();
}
