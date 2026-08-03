import type { ComponentType } from 'react';
import type { FileTreeProps } from './FileTree';

interface FileTreeModule {
  FileTree: ComponentType<FileTreeProps>;
}

let fileTreePromise: Promise<FileTreeModule> | null = null;

/**
 * Share one project-explorer implementation across sidebar activations.
 *
 * Failed module fetches remain cached for this document because browsers keep
 * failed module URLs in the module map. The host offers a page reload instead
 * of pretending that the same import can retry reliably.
 */
export function loadFileTree(): Promise<FileTreeModule> {
  fileTreePromise ??= import('./FileTree');
  return fileTreePromise;
}
