/**
 * File system permissions layer.
 *
 * Defines which paths are protected against write and delete operations
 * to prevent accidental damage to system or sensitive user files.
 */

import path from 'node:path';
import os from 'node:os';

const home = os.homedir();

/** Paths that are always blocked from write/delete operations */
const BLOCKED_PATHS: string[] = [
  // macOS / Linux system paths
  '/etc',
  '/System',
  '/private',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  // Windows system paths
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  // Sensitive home directories
  path.join(home, '.ssh'),
  path.join(home, '.gnupg'),
  path.join(home, '.aws'),
  path.join(home, 'Library', 'Keychains'),
];

/**
 * Returns true if the given path is blocked for the given operation.
 * All operations (read, write, delete) are checked against BLOCKED_PATHS.
 */
export function isPathBlocked(
  filePath: string,
  _operation: 'read' | 'write' | 'delete'
): boolean {
  const normalizedTarget = path.normalize(path.resolve(filePath));

  return BLOCKED_PATHS.some((blocked) => {
    const normalizedBlocked = path.normalize(path.resolve(blocked));
    return (
      normalizedTarget === normalizedBlocked ||
      normalizedTarget.startsWith(normalizedBlocked + path.sep)
    );
  });
}

/**
 * Returns true if the given file path is within the project root.
 * Used to enforce the per-project sandbox when desired.
 */
export function isPathWithinProject(
  filePath: string,
  projectRoot: string
): boolean {
  const normalizedFile = path.normalize(path.resolve(filePath));
  const normalizedRoot = path.normalize(path.resolve(projectRoot));
  return (
    normalizedFile === normalizedRoot ||
    normalizedFile.startsWith(normalizedRoot + path.sep)
  );
}
