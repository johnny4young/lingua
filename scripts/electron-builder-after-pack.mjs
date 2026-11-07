/**
 * electron-builder afterPack hook. DuckDB's macOS binding package carries a
 * universal libduckdb (x86_64 and arm64, about 111 MB); each Lingua app is one
 * architecture, so the other slice and the local symbols are dropped here,
 * before electron-builder signs the bundle.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// electron-builder's Arch enum.
const LIPO_ARCH = { 1: 'x86_64', 3: 'arm64' };

function findLibraries(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findLibraries(full, found);
    else if (entry.name === 'libduckdb.dylib' && full.includes('app.asar.unpacked')) found.push(full);
  }
  return found;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = LIPO_ARCH[context.arch];
  if (!arch) throw new Error(`No lipo architecture for electron-builder arch ${context.arch}`);
  for (const library of findLibraries(context.appOutDir)) {
    const slices = execFileSync('lipo', ['-archs', library], { encoding: 'utf8' }).trim().split(/\s+/);
    if (!slices.includes(arch)) throw new Error(`${library} has no ${arch} slice (${slices.join(', ')})`);
    if (slices.length > 1) execFileSync('lipo', ['-thin', arch, library, '-output', library]);
    execFileSync('strip', ['-x', library]);
  }
}
