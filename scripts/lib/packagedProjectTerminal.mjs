import { stat } from 'node:fs/promises';
import path from 'node:path';

export async function assertPackagedMacProjectTerminalRuntime(appPath) {
  const nativeRoot = path.join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'build',
    'Release'
  );
  const addonPath = path.join(nativeRoot, 'pty.node');
  const helperPath = path.join(nativeRoot, 'spawn-helper');

  let addon;
  let helper;
  try {
    [addon, helper] = await Promise.all([stat(addonPath), stat(helperPath)]);
  } catch (error) {
    throw new Error(
      `Packaged project terminal runtime is incomplete under ${nativeRoot}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  if (!addon.isFile() || !helper.isFile()) {
    throw new Error(
      `Packaged project terminal runtime contains a non-file artifact under ${nativeRoot}`
    );
  }
  if ((helper.mode & 0o111) === 0) {
    throw new Error(`Packaged node-pty spawn-helper is not executable: ${helperPath}`);
  }

  return { addonPath, helperPath };
}
