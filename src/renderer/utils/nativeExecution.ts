/**
 * RL-079 — shared helpers for the trust-boundary gate.
 *
 * Imported by both `useRunner` (manual Run) and `useAutoRun` (debounced
 * auto-run on edit) so the acknowledgement requirement applies
 * uniformly across every entry point. Without this, opening a Go or
 * Rust tab and typing a character would silently invoke the local
 * toolchain before the user has ever seen the modal.
 */
import type { Language } from '../types';

const NATIVE_EXECUTION_LANGUAGES = new Set<Language>(['go', 'rust']);

/**
 * Languages whose execution leaves the renderer / worker sandbox and
 * runs as a real OS subprocess via the host toolchain. The trust
 * modal gates these on first run per install.
 */
export function requiresNativeExecutionAcknowledgement(
  language: Language
): boolean {
  if (typeof window !== 'undefined' && window.lingua?.platform === 'web') {
    return false;
  }

  return NATIVE_EXECUTION_LANGUAGES.has(language);
}
