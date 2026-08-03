/**
 * internal — shared helpers for the trust-boundary gate.
 *
 * Imported by both `useRunner` (manual Run) and `useAutoRun` (debounced
 * auto-run on edit) so the acknowledgement requirement applies
 * uniformly across every entry point. Without this, opening a Go,
 * Rust, or system-Ruby tab and typing a character would silently
 * invoke the local toolchain before the user has ever seen the modal.
 */
import type { Language } from '../types/language';

const NATIVE_EXECUTION_LANGUAGES = new Set<Language>(['go', 'rust']);

interface NativeExecutionOptions {
  rubyRuntimePreference?: string;
  rubyBridgeAvailable?: boolean;
  pythonDebuggerRequested?: boolean;
}

/**
 * Languages whose execution leaves the renderer / worker sandbox and
 * runs as a real OS subprocess via the host toolchain. The trust
 * modal gates these on first run per install.
 */
export function requiresNativeExecutionAcknowledgement(
  language: Language,
  options: NativeExecutionOptions = {}
): boolean {
  if (typeof window !== 'undefined' && window.lingua?.platform === 'web') {
    return false;
  }

  if (language === 'ruby') {
    return (
      options.rubyBridgeAvailable === true &&
      options.rubyRuntimePreference !== 'wasm'
    );
  }

  if (language === 'python') {
    return options.pythonDebuggerRequested === true;
  }

  return NATIVE_EXECUTION_LANGUAGES.has(language);
}
