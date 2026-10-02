import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

async function isHostFile(candidate: string, executable: boolean): Promise<boolean> {
  try {
    await access(candidate, executable ? fsConstants.X_OK : fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the first of `names` on the absolute entries of `env.PATH`. Empty and
 * relative entries resolve against the untrusted project cwd, and Windows also
 * searches the spawn cwd before PATH for bare names, so both allow binary planting.
 */
export async function resolveHostExecutable(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | null> {
  const rawPath = typeof env.PATH === 'string' ? env.PATH : '';
  const windowsExtensions =
    platform === 'win32'
      ? (typeof env.PATHEXT === 'string' ? env.PATHEXT : '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];

  for (const directory of rawPath.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    for (const name of names) {
      const variants =
        platform === 'win32' && path.extname(name) === ''
          ? windowsExtensions.map(extension => `${name}${extension.toLowerCase()}`)
          : [name];
      for (const variant of variants) {
        const candidate = path.join(directory, variant);
        if (await isHostFile(candidate, platform !== 'win32')) return candidate;
      }
    }
  }
  return null;
}

/**
 * Windows launch plan for a PATH tool: its absolute path, or the allowlisted
 * COMSPEC for `.cmd`/`.bat` shims, which cannot spawn without a command
 * interpreter. Null means missing; never fall back to the bare name.
 */
export async function resolveWindowsLaunch(
  name: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ command: string; args: string[] } | null> {
  const resolved = await resolveHostExecutable([name], env, 'win32');
  if (resolved === null) return null;
  if (!/\.(?:cmd|bat)$/iu.test(resolved)) return { command: resolved, args: [...args] };
  const comspec = typeof env.COMSPEC === 'string' ? env.COMSPEC : '';
  if (!path.isAbsolute(comspec)) return null;
  return { command: comspec, args: ['/d', '/c', resolved, ...args] };
}
