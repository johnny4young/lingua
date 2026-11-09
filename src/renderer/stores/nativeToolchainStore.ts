import { create } from 'zustand';
import type { ToolchainChooseResult } from '../../shared/toolchainBinary';
import { resolveUserEnvForNativeProbe } from '../runners/env';
import { cachedNativeProbe } from '../utils/nativeProbeCache';
import { nativeDetectStatus, type NativeJsRuntimeStatus } from '../utils/nativeJsRuntimeStatus';
import { isNativeLanguageToolchain, type NativeLanguageToolchain } from '../utils/nativeLanguageToolchainStatus';

interface NativeToolchainEntry {
  status: NativeJsRuntimeStatus;
  /** Folders checked besides PATH, home-relative; empty unless missing. */
  searched: string[];
  /** The picked binary, home-relative; null on PATH, undefined until read. */
  chosenPath?: string | null;
}

interface DetectAnswer {
  installed: boolean;
  reason?: 'missing' | 'check-failed';
  searched?: string[];
}

interface NativeToolchainState extends Record<NativeLanguageToolchain, NativeToolchainEntry> {
  report: (id: NativeLanguageToolchain, answer: DetectAnswer) => void;
  probe: (id: NativeLanguageToolchain, options?: { refresh?: boolean }) => Promise<NativeJsRuntimeStatus>;
  /** `failed` means main could not finish the pick (IPC or store error). */
  choose: (id: NativeLanguageToolchain) => Promise<ToolchainChooseResult | { status: 'failed' }>;
  loadChoice: (id: NativeLanguageToolchain) => Promise<void>;
  /** Back to PATH; false when main could not forget the pick. */
  clearChoice: (id: NativeLanguageToolchain) => Promise<boolean>;
}

const CHECKING: NativeToolchainEntry = { status: 'checking', searched: [] };
const inFlight = new Map<NativeLanguageToolchain, Promise<NativeJsRuntimeStatus>>();

function desktopBridge(id: NativeLanguageToolchain) {
  if (typeof window === 'undefined' || !window.lingua || window.lingua.platform === 'web') return null;
  return window.lingua[id] ?? null;
}

/** Session-only Go and Rust availability shared by Run, the Dock and the menus. */
export const useNativeToolchainStore = create<NativeToolchainState>((set, get) => ({
  go: CHECKING,
  rust: CHECKING,

  report: (id, answer) => {
    const status = nativeDetectStatus(answer);
    set((state) => ({ [id]: { ...state[id], status, searched: status === 'missing' ? (answer.searched ?? []) : [] } }));
  },

  probe: (id, { refresh = false } = {}) => {
    const bridge = desktopBridge(id);
    if (!bridge?.detect) return Promise.resolve(get()[id].status);
    const pending = inFlight.get(id);
    if (pending && !refresh) return pending;
    const env = resolveUserEnvForNativeProbe(id, window.lingua?.platform);
    const run = cachedNativeProbe(id, env, () => bridge.detect(env), { refresh })
      .then(
        (answer) => {
          get().report(id, answer);
          return get()[id].status;
        },
        () => {
          get().report(id, { installed: false, reason: 'check-failed' });
          return 'check-failed' as const;
        }
      )
      .finally(() => {
        if (inFlight.get(id) === run) inFlight.delete(id);
      });
    inFlight.set(id, run);
    return run;
  },

  choose: async (id) => {
    const bridge = desktopBridge(id);
    if (!bridge?.chooseBinary) return { status: 'canceled' };
    const result = await bridge.chooseBinary().catch(() => ({ status: 'failed' }) as const);
    if (result.status === 'saved') await Promise.all([get().probe(id, { refresh: true }), get().loadChoice(id)]);
    return result;
  },

  loadChoice: async (id) => {
    const bridge = desktopBridge(id);
    if (!bridge?.chosenBinary) return;
    const answer = await bridge.chosenBinary().catch(() => null);
    if (answer) set((state) => ({ [id]: { ...state[id], chosenPath: answer.path } }));
  },

  clearChoice: async (id) => {
    const bridge = desktopBridge(id);
    if (!bridge?.clearBinary) return false;
    const answer = await bridge.clearBinary().catch(() => ({ cleared: false }));
    await Promise.all([get().probe(id, { refresh: true }), get().loadChoice(id)]);
    return answer.cleared;
  },
}));

/** Auto-run skips a desktop Go or Rust tab whose binary was last reported missing. */
export function isNativeToolchainMissing(language: string): boolean {
  return (
    isNativeLanguageToolchain(language) &&
    desktopBridge(language) !== null &&
    useNativeToolchainStore.getState()[language].status === 'missing'
  );
}

export function resetNativeToolchainStoreForTests(): void {
  inFlight.clear();
  useNativeToolchainStore.setState({ go: CHECKING, rust: CHECKING });
}
