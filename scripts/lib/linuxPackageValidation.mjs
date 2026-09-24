import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as parseYaml } from 'js-yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function manifestObject(text) {
  const parsed = parseYaml(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('latest-linux.yml must contain a YAML object');
  }
  return parsed;
}

async function sha512OfFile(filePath) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('base64');
}

async function assertType2AppImage(filePath) {
  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(11);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))
    ) {
      throw new Error('Linux installer is not an ELF AppImage type 2');
    }
  } finally {
    await file.close();
  }
}

/** Validate current electron-builder Linux output before release artifact upload. */
export async function validateLinuxPackage(root) {
  const resolvedRoot = path.resolve(root);
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = pkg.version;
  const productName = pkg.productName;
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    typeof productName !== 'string' ||
    productName.length === 0
  ) {
    throw new Error('Root package.json has no release version or product name');
  }

  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const installers = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.AppImage'))
    .map(entry => entry.name);
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one top-level Linux AppImage; found ${installers.length}`);
  }
  const installer = installers[0];
  const expectedNames = ['x64', 'x86_64', 'arm64'].map(
    arch => `${productName}-${version}-linux-${arch}.AppImage`
  );
  if (!expectedNames.includes(installer)) {
    throw new Error(`Linux AppImage name/version mismatch: ${installer}`);
  }
  const installerPath = path.join(resolvedRoot, installer);
  const info = await stat(installerPath);
  if (info.size === 0) throw new Error('Linux AppImage is empty');
  if (process.platform !== 'win32' && (info.mode & 0o111) === 0) {
    throw new Error('Linux AppImage is not executable');
  }
  await assertType2AppImage(installerPath);

  const manifest = manifestObject(
    await readFile(path.join(resolvedRoot, 'latest-linux.yml'), 'utf8')
  );
  if (manifest.version !== version) {
    throw new Error(`latest-linux.yml version mismatch: expected ${version}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error('latest-linux.yml must contain exactly one files[] entry');
  }
  const file = manifest.files[0];
  if (!file || typeof file !== 'object' || file.url !== installer) {
    throw new Error(`latest-linux.yml does not reference the published installer ${installer}`);
  }
  if (!Number.isSafeInteger(file.size) || file.size !== info.size) {
    throw new Error(`latest-linux.yml size mismatch for ${installer}`);
  }
  const sha512 = await sha512OfFile(installerPath);
  if (file.sha512 !== sha512 || (manifest.sha512 !== undefined && manifest.sha512 !== sha512)) {
    throw new Error(`latest-linux.yml sha512 mismatch for ${installer}`);
  }
  if (manifest.path !== undefined && manifest.path !== installer) {
    throw new Error(`latest-linux.yml legacy path does not reference ${installer}`);
  }

  return {
    root: resolvedRoot,
    installer,
    updateManifest: 'latest-linux.yml',
    version,
    size: info.size,
    sha512,
  };
}
