/**
 * Shared language-detection utilities.
 * Single source of truth for mapping file extensions → Language.
 */

import type { Language } from '../types';

/**
 * Infer a Language from a full file path or filename.
 * Falls back to 'javascript' for unknown extensions.
 */
export function languageFromPath(filePath: string): Language {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (
    filePath.endsWith('.js') ||
    filePath.endsWith('.jsx') ||
    filePath.endsWith('.mjs') ||
    filePath.endsWith('.cjs')
  )
    return 'javascript';
  if (filePath.endsWith('.go')) return 'go';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  return 'javascript';
}
