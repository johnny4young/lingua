const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces a folder in a message however DuckDB or the OS spelled it: either
 * separator, and any case on Windows. `trailing` also takes the separator after it.
 */
export function withoutFolder(message: string, folder: string, replacement: string, trailing = false): string {
  const parts = folder.split(/[\\/]/).filter(Boolean).map(escapeRegExp);
  if (parts.length === 0) return message;
  const lead = /^[\\/]/.test(folder) ? '[\\\\/]' : '';
  const pattern = new RegExp(`${lead}${parts.join('[\\\\/]')}${trailing ? '[\\\\/]' : ''}`, process.platform === 'win32' ? 'gi' : 'g');
  return message.replace(pattern, replacement);
}
