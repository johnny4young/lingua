/**
 * electron-builder afterPack hook. DuckDB's macOS binding package carries a
 * universal libduckdb (x86_64 and arm64, about 111 MB); each Lingua app is one
 * architecture, so the other slice and the local symbols are dropped here,
 * before electron-builder signs the bundle.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// electron-builder's Arch enum: lipo's slice name and Node's arch name.
const ARCHES = { 1: { lipo: 'x86_64', node: 'x64' }, 3: { lipo: 'arm64', node: 'arm64' } };

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = ARCHES[context.arch];
  if (!arch) throw new Error(`No lipo architecture for electron-builder arch ${context.arch}`);
  const library = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents/Resources/app.asar.unpacked/node_modules/@duckdb',
    `node-bindings-darwin-${arch.node}`,
    'libduckdb.dylib'
  );
  // A build that lost the binding would otherwise ship and quietly fall back to WASM.
  if (!fs.existsSync(library)) throw new Error(`DuckDB binding missing from the packaged app: ${library}`);
  const slices = execFileSync('lipo', ['-archs', library], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!slices.includes(arch.lipo)) throw new Error(`${library} has no ${arch.lipo} slice (${slices.join(', ')})`);
  if (slices.length > 1) execFileSync('lipo', ['-thin', arch.lipo, library, '-output', library]);
  execFileSync('strip', ['-x', library]);
}
