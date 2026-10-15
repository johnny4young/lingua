#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { isDirectInvocation } from './lib/isDirectInvocation.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const REPO_URL = 'https://github.com/johnny4young/lingua';

/** Body of the dated `## [X.Y.Z] — YYYY-MM-DD` CHANGELOG section, without its heading. */
export function extractChangelogSection(changelogText, version) {
  const lines = changelogText.split('\n');
  const heading = new RegExp(`^## \\[${version.replace(/\./gu, '\\.')}\\] — \\d{4}-\\d{2}-\\d{2}\\s*$`, 'u');
  const start = lines.findIndex(line => heading.test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no dated section for ${version}.`);
  const end = lines.findIndex((line, index) => index > start && /^## \[/u.test(line));
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md section ${version} is empty.`);
  return body;
}

/**
 * Draft GitHub Release notes. The trust lines describe only the platforms
 * actually built and the signing that actually happened.
 *
 * @param {{ version: string, section: string, platforms: { macos: boolean, windows: boolean, linux: boolean, cli: boolean }, macNotarized: boolean, windowsSigned: boolean }} options
 */
export function renderReleaseNotes({ version, section, platforms, macNotarized, windowsSigned }) {
  const trust = [];
  if (platforms.macos) {
    trust.push(
      macNotarized
        ? '- macOS arm64/x64: Developer ID signed and notarized `.dmg` and updater `.zip`.'
        : '- macOS arm64/x64: **ad-hoc signed preview**, not notarized; Gatekeeper blocks it until you approve it.'
    );
  }
  if (platforms.linux) trust.push('- Linux x64: AppImage.');
  if (platforms.windows) {
    trust.push(
      windowsSigned
        ? '- Windows x64: Authenticode-signed NSIS installer.'
        : '- **Windows x64 preview:** the NSIS installer and standalone CLI are **unsigned**. SmartScreen may warn; verify the file against `SHA256SUMS.txt` before choosing to run it. This release does not claim Authenticode trust.'
    );
  }
  const attached = [
    platforms.macos || platforms.windows || platforms.linux ? 'desktop updater manifests' : null,
    platforms.cli ? 'CLI archives, npm-package tarball' : null,
    'SBOM, third-party license report, and SHA-256 manifest',
  ].filter(Boolean);
  trust.push(`- Attached: ${attached.join(', ')}.`);

  return [
    `## Lingua ${version}`,
    '',
    '<!-- Replace with a one-paragraph summary and highlights before promoting this draft. -->',
    '',
    section,
    '',
    `See the [full changelog](${REPO_URL}/blob/v${version}/CHANGELOG.md).`,
    '',
    '### Downloads and trust',
    '',
    ...trust,
    '',
    `Clean-machine installation and previous-version → ${version} updater validation are performed after publication by the maintainer; they are **not** claimed as prepublication evidence. The npm registry package and Homebrew tap have separate promotion steps and may temporarily remain on earlier versions.`,
    '',
  ].join('\n');
}

function main() {
  const { values } = parseArgs({
    args: stripArgSeparator(process.argv.slice(2)),
    options: {
      tag: { type: 'string' },
      changelog: { type: 'string', default: path.join(repoRoot, 'CHANGELOG.md') },
      platforms: { type: 'string', default: 'macos,windows,linux,cli' },
      'mac-notarized': { type: 'boolean', default: false },
      'windows-signed': { type: 'boolean', default: false },
    },
  });
  if (!values.tag || !/^v\d+\.\d+\.\d+$/u.test(values.tag)) {
    throw new Error('Usage: node scripts/release-notes.mjs --tag vX.Y.Z [--platforms macos,windows,linux,cli] [--mac-notarized] [--windows-signed]');
  }
  const selected = new Set(values.platforms.split(',').map(entry => entry.trim()).filter(Boolean));
  const version = values.tag.slice(1);
  process.stdout.write(
    renderReleaseNotes({
      version,
      section: extractChangelogSection(readFileSync(values.changelog, 'utf8'), version),
      platforms: {
        macos: selected.has('macos'),
        windows: selected.has('windows'),
        linux: selected.has('linux'),
        cli: selected.has('cli'),
      },
      macNotarized: values['mac-notarized'],
      windowsSigned: values['windows-signed'],
    })
  );
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`release-notes: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
