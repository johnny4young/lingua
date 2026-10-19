/**
 * Guard: locally packaged desktop builds get their own userData profile.
 *
 * Release workflow builds must stay unmarked so installed apps keep the
 * `Lingua` profile; every local packaging path must carry the marker so an
 * older local build cannot rewrite the installed app's license or data.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_CHANNEL_METADATA_KEY, LOCAL_BUILD_CHANNEL } from '../../src/main/userDataProfile';

const root = resolve(__dirname, '../..');
const marker = `-c.extraMetadata.${BUILD_CHANNEL_METADATA_KEY}=${LOCAL_BUILD_CHANNEL}`;
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf-8');

describe('local build channel marker', () => {
  it('marks every local electron-builder script except the publish path', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const builderScripts = Object.entries(scripts).filter(
      ([, command]) => command.includes('electron-builder') && !command.includes('--publish always')
    );
    expect(builderScripts.length).toBeGreaterThan(0);
    for (const [name, command] of builderScripts) {
      expect(command, `${name} must carry ${marker}`).toContain(marker);
    }
    expect(scripts['publish:desktop']).not.toContain(marker);
  });

  it('marks the packaged smoke builds', () => {
    for (const script of [
      'scripts/smoke-notebook-packaged.mjs',
      'scripts/smoke-lsp-navigation.mjs',
      'scripts/smoke-notebook-documents.mjs',
    ]) {
      expect(read(script), script).toContain(marker.replace(/^-c\./, "'-c.").concat("'"));
    }
  });

  it('never marks a release workflow build', () => {
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain('electron-builder');
    expect(workflow).not.toContain(BUILD_CHANNEL_METADATA_KEY);
  });
});
