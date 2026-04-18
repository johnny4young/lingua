/**
 * Shared language-detection utilities.
 * Single source of truth for mapping file extensions → Language.
 */

import type { Language } from '../types';
import { pluginRegistry } from '../plugins';
import { languageForExtension, languageSupportsFileName } from './languageMeta';

/**
 * Fallback language used whenever a file has no recognizable extension.
 * Resolves through Monaco to the plaintext mode so unknown files open in a
 * neutral editor instead of being misreported as JavaScript.
 */
export const PLAINTEXT_LANGUAGE: Language = 'plaintext';

function extensionFromPath(filePath: string): string | undefined {
  const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return undefined;
  }

  return fileName.slice(dotIndex + 1);
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
}

function languageFromSpecialFileName(fileName: string): Language | undefined {
  if (fileName.startsWith('.env')) {
    return 'dotenv';
  }

  // Dockerfile variants (Dockerfile, Dockerfile.dev, Dockerfile.prod, ...)
  // share the same grammar — match on the base prefix rather than forcing
  // every variant to live in `fileNames`.
  if (fileName === 'Dockerfile' || fileName.startsWith('Dockerfile.')) {
    return 'dockerfile';
  }

  const builtInCandidates: Language[] = [
    'dotenv',
    'dockerfile',
    'makefile',
    'gitignore',
    'editorconfig',
  ];
  return builtInCandidates.find((candidate) => languageSupportsFileName(candidate, fileName));
}

/**
 * Infer a Language from a full file path or filename.
 * Returns undefined for unknown extensions so callers can choose an
 * appropriate fallback such as Monaco plaintext mode.
 */
export function languageFromPath(filePath: string): Language | undefined {
  const fileName = fileNameFromPath(filePath);
  const specialCaseLanguage = languageFromSpecialFileName(fileName);
  if (specialCaseLanguage) {
    return specialCaseLanguage;
  }

  const extension = extensionFromPath(filePath);
  if (!extension) {
    return undefined;
  }

  const normalized = extension.toLowerCase();
  for (const plugin of pluginRegistry.getAll()) {
    if (plugin.extensions.some((candidate) => candidate.replace(/^\./u, '').toLowerCase() === normalized)) {
      return plugin.language;
    }
  }

  return languageForExtension(extension);
}

/**
 * Resolve a file path to a concrete editor language, falling back to the
 * plaintext mode when the extension is unknown. Centralized so the Electron
 * editor store, the session restore flow, and the file-tree click handler
 * stay in sync on how unknown extensions should behave.
 */
export function resolveFileLanguageOrPlaintext(
  filePathOrLanguage: string | Language | undefined
): Language {
  if (typeof filePathOrLanguage !== 'string') {
    return PLAINTEXT_LANGUAGE;
  }

  return languageFromPath(filePathOrLanguage) ?? PLAINTEXT_LANGUAGE;
}
