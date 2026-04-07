/**
 * Shared language-detection utilities.
 * Single source of truth for mapping file extensions → Language.
 */

import type { Language } from '../types';
import { pluginRegistry } from '../plugins';

/**
 * Infer a Language from a full file path or filename.
 * Falls back to 'javascript' for unknown extensions.
 */
export function languageFromPath(filePath: string): Language {
  const normalizedPath = filePath.toLowerCase();

  for (const plugin of pluginRegistry.getAll()) {
    if (plugin.extensions.some((ext) => normalizedPath.endsWith(ext.toLowerCase()))) {
      return plugin.language;
    }
  }

  if (normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx')) return 'typescript';
  if (
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.jsx') ||
    normalizedPath.endsWith('.mjs') ||
    normalizedPath.endsWith('.cjs')
  )
    return 'javascript';
  if (normalizedPath.endsWith('.go')) return 'go';
  if (normalizedPath.endsWith('.py')) return 'python';
  if (normalizedPath.endsWith('.rs')) return 'rust';
  return 'javascript';
}
