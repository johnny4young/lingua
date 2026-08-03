import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const REACT_DEVELOPMENT_MARKERS = [
  'Download the React DevTools for a better development experience',
];

/**
 * Canonical production build commands must not inherit a parent shell's
 * NODE_ENV. Vite's production mode and NODE_ENV are separate inputs: an
 * ambient development value selects React's development runtime even during
 * `vite build`.
 */
export function forceProductionNodeEnv(env = process.env) {
  env.NODE_ENV = 'production';
}

/**
 * Fail after a renderer build if any generated JavaScript contains React's
 * development diagnostics. The NODE_ENV assignment above prevents the issue;
 * scanning the full asset graph keeps future chunk-name and build-script
 * refactors honest.
 */
export async function assertProductionReactBundle(assetsDir) {
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const candidates = entries
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.js')
    )
    .map(entry => entry.name);

  if (candidates.length === 0) {
    throw new Error(`No renderer JavaScript assets found in ${assetsDir}`);
  }

  for (const fileName of candidates) {
    const source = await readFile(path.join(assetsDir, fileName), 'utf8');
    const marker = REACT_DEVELOPMENT_MARKERS.find(candidate => source.includes(candidate));
    if (marker) {
      throw new Error(
        `Production renderer artifact ${fileName} contains React development code (${marker})`
      );
    }
  }
}
