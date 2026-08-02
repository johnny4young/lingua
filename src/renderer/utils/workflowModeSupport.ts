import {
  coerceWorkflowMode,
  defaultWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';

function isWebShell(): boolean {
  return typeof window !== 'undefined' && window.lingua?.platform === 'web';
}

/** Apply renderer-shell availability on top of the shared language matrix. */
export function supportsWorkflowModeInShell(
  language: string | null | undefined,
  mode: WorkflowMode,
  webShell = isWebShell()
): boolean {
  const normalizedLanguage = language ?? undefined;
  return (
    supportsWorkflowMode(normalizedLanguage, mode) &&
    !(webShell && (language === 'python' || language === 'go') && mode === 'debug')
  );
}

/** Coerce persisted/default modes without rehydrating a desktop-only web state. */
export function coerceWorkflowModeInShell(
  value: unknown,
  language: string | null | undefined,
  webShell = isWebShell()
): WorkflowMode {
  const normalizedLanguage = language ?? undefined;
  const coerced = coerceWorkflowMode(value, normalizedLanguage);
  return supportsWorkflowModeInShell(language, coerced, webShell)
    ? coerced
    : defaultWorkflowMode(normalizedLanguage);
}
