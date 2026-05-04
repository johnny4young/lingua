/**
 * RL-079 — Cross-component gate state for the native-execution
 * trust-boundary modal.
 *
 * Multiple surfaces invoke `useRunner()` independently (Toolbar,
 * ConsolePanel, Cmd+Enter from App) and each call would create its
 * own local React state. We hoist the "should the modal show?" flag
 * into this tiny zustand store so the modal can mount once at App
 * level and any runner entry point can request it without prop
 * drilling. The store is intentionally NOT persisted — the
 * acknowledgement itself lives on `settingsStore.nativeExecutionAcknowledged`.
 */
import { create } from 'zustand';
import type { Language } from '../types';

interface NativeExecutionGateState {
  /** Language whose run is pending acknowledgement, or `null` if no run is gated. */
  pendingLanguage: Language | null;
  /** Resume callback the modal invokes on Acknowledge. Cleared after use. */
  pendingResume: (() => void) | null;
  /**
   * Open the modal for `language` and remember the `resume` callback
   * that should fire after the user acknowledges. If a previous
   * pending request is still queued (rapid double-click), this
   * replaces it — the older callback is dropped on the floor, which
   * is fine because the user clearly intended the latest intent.
   */
  request: (language: Language, resume: () => void) => void;
  /** Modal calls this on Acknowledge after flipping the persisted flag. */
  confirm: () => void;
  /** Modal calls this on Cancel (button, backdrop, Escape). */
  cancel: () => void;
}

export const useNativeExecutionGateStore = create<NativeExecutionGateState>(
  (set, get) => ({
    pendingLanguage: null,
    pendingResume: null,
    request: (language, resume) => {
      set({ pendingLanguage: language, pendingResume: resume });
    },
    confirm: () => {
      const resume = get().pendingResume;
      set({ pendingLanguage: null, pendingResume: null });
      resume?.();
    },
    cancel: () => {
      set({ pendingLanguage: null, pendingResume: null });
    },
  })
);
