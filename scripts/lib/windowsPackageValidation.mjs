import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { load as parseYaml } from 'js-yaml';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseDocument(text, source) {
  const value = parseYaml(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a YAML object`);
  }
  return value;
}

function referencedUrls(manifest) {
  const urls = [];
  if (typeof manifest.path === 'string') urls.push(manifest.path);
  if (Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      if (file && typeof file === 'object' && typeof file.url === 'string') {
        urls.push(file.url);
      }
    }
  }
  return urls.map(value => path.basename(value));
}

/**
 * Validate the Windows installer, updater metadata, and unpacked application
 * produced by electron-builder. The release workflow runs this on
 * windows-latest before uploading anything to GitHub Releases.
 */
export async function validateWindowsPackage(root) {
  const resolvedRoot = path.resolve(root);
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const installers = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map(entry => entry.name);
  if (installers.length !== 1) {
    throw new Error(
      `Expected exactly one top-level Windows installer in ${resolvedRoot}; found ${installers.length}: ${installers.join(', ') || 'none'}`
    );
  }

  const installer = installers[0];
  if (!/-(?:win|windows)-x64\.exe$/iu.test(installer)) {
    throw new Error(
      `Expected an x64 NSIS installer named Lingua-<version>-win-x64.exe; found ${installer}`
    );
  }
  const latestPath = path.join(resolvedRoot, 'latest.yml');
  const latest = parseDocument(await readFile(latestPath, 'utf8'), 'latest.yml');
  const refs = referencedUrls(latest);
  if (!refs.includes(installer)) {
    throw new Error(`latest.yml does not reference the published installer ${installer}`);
  }

  const blockmap = `${installer}.blockmap`;
  if (!(await exists(path.join(resolvedRoot, blockmap)))) {
    throw new Error(`Missing differential-update blockmap ${blockmap}`);
  }

  const unpackedRoot = path.join(resolvedRoot, 'win-unpacked');
  const executablePath = path.join(unpackedRoot, 'lingua.exe');
  const asarPath = path.join(unpackedRoot, 'resources', 'app.asar');
  const appUpdatePath = path.join(unpackedRoot, 'resources', 'app-update.yml');
  for (const requiredPath of [executablePath, asarPath, appUpdatePath]) {
    if (!(await exists(requiredPath))) {
      throw new Error(
        `Packaged Windows application is missing ${path.relative(resolvedRoot, requiredPath)}`
      );
    }
  }

  const appUpdate = parseDocument(await readFile(appUpdatePath, 'utf8'), 'app-update.yml');
  if (
    appUpdate.provider !== 'github' ||
    appUpdate.owner !== 'johnny4young' ||
    appUpdate.repo !== 'lingua'
  ) {
    throw new Error('app-update.yml must target the github provider at johnny4young/lingua');
  }

  return {
    root: resolvedRoot,
    installer,
    blockmap,
    updateManifest: 'latest.yml',
    executable: path.relative(resolvedRoot, executablePath),
    appArchive: path.relative(resolvedRoot, asarPath),
    updateProvider: 'github:johnny4young/lingua',
  };
}
