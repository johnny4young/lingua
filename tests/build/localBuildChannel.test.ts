/**
 * Guard: locally packaged desktop builds get their own userData profile and
 * bundle id.
 *
 * Release workflow builds must stay unmarked so installed apps keep the
 * `Lingua` profile and `com.lingua.app`; every local packaging path must carry
 * both overrides so an older local build cannot rewrite the installed app's
 * data or answer for its bundle id and `lingua://` links.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_CHANNEL_METADATA_KEY, LOCAL_BUILD_CHANNEL } from '../../src/main/userDataProfile';

const root = resolve(__dirname, '../..');
const marker = `-c.extraMetadata.${BUILD_CHANNEL_METADATA_KEY}=${LOCAL_BUILD_CHANNEL}`;
const localAppId = '-c.appId=com.lingua.app.local';
const quoted = (flag: string) => `'${flag}'`;
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf-8');

describe('local build markers', () => {
  it('marks every local electron-builder script except the publish path', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const builderScripts = Object.entries(scripts).filter(
      ([, command]) => command.includes('electron-builder') && !command.includes('--publish always')
    );
    expect(builderScripts.length).toBeGreaterThan(0);
    for (const [name, command] of builderScripts) {
      expect(command, `${name} must carry ${marker}`).toContain(marker);
      expect(command, `${name} must carry ${localAppId}`).toContain(localAppId);
    }
    expect(scripts['publish:desktop']).not.toContain(marker);
    expect(scripts['publish:desktop']).not.toContain(localAppId);
  });

  it('marks every script that packages through the electron-builder CLI', () => {
    const builderScripts = readdirSync(resolve(root, 'scripts'), { recursive: true, encoding: 'utf-8' })
      .filter((file) => file.endsWith('.mjs'))
      .map((file) => `scripts/${file}`)
      .filter((script) => read(script).includes('electron-builder/out/cli/cli.js'));
    expect(builderScripts.length).toBeGreaterThan(0);
    for (const script of builderScripts) {
      expect(read(script), script).toContain(quoted(marker));
      expect(read(script), script).toContain(quoted(localAppId));
    }
  });

  it('never marks a release workflow build', () => {
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain('electron-builder');
    expect(workflow).not.toContain(BUILD_CHANNEL_METADATA_KEY);
    expect(workflow).not.toContain('-c.appId');
  });
});
