import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const real = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

/**
 * True for a file inside ~/.ssh, as given and after resolving links. Tunnel
 * keys are the one exception to the protected credentials folders; the key
 * is read in main and never returned to the renderer.
 */
export function isSshFolderFile(file: string, home = homedir()): boolean {
  const folder = path.join(home, '.ssh') + path.sep;
  const realFolder = real(path.join(home, '.ssh')) + path.sep;
  return path.resolve(file).startsWith(folder) && real(file).startsWith(realFolder);
}
