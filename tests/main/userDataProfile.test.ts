import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readBuildChannel,
  resolveUserDataOverride,
  resolveUserDataProfile,
  shouldRegisterProtocolClient,
} from '../../src/main/userDataProfile';

const DEFAULT_DIR = '/Users/me/Library/Application Support/Lingua';

describe('userData profile', () => {
  it('keeps the installed folder for release builds and isolates dev and local builds', () => {
    expect(resolveUserDataProfile({ isPackaged: true, buildChannel: null })).toBe('release');
    expect(resolveUserDataProfile({ isPackaged: true, buildChannel: 'beta' })).toBe('release');
    expect(resolveUserDataProfile({ isPackaged: true, buildChannel: 'local' })).toBe('local');
    expect(resolveUserDataProfile({ isPackaged: false, buildChannel: null })).toBe('dev');

    expect(resolveUserDataOverride({ profile: 'release', defaultUserDataDir: DEFAULT_DIR })).toBeNull();
    expect(resolveUserDataOverride({ profile: 'dev', defaultUserDataDir: DEFAULT_DIR })).toBe(`${DEFAULT_DIR} Dev`);
    expect(resolveUserDataOverride({ profile: 'local', defaultUserDataDir: DEFAULT_DIR })).toBe(
      `${DEFAULT_DIR} Local`
    );
  });

  it('lets an explicit smoke directory win over every profile', () => {
    for (const profile of ['release', 'dev', 'local'] as const) {
      expect(
        resolveUserDataOverride({ profile, defaultUserDataDir: DEFAULT_DIR, smokeUserDataDir: ' /tmp/smoke ' })
      ).toBe('/tmp/smoke');
    }
    expect(
      resolveUserDataOverride({ profile: 'release', defaultUserDataDir: DEFAULT_DIR, smokeUserDataDir: '  ' })
    ).toBeNull();
  });

  it('reads the build channel from the packaged package.json and fails soft', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lingua-channel-'));
    expect(readBuildChannel(dir)).toBeNull();
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ linguaBuildChannel: 'local' }));
    expect(readBuildChannel(dir)).toBe('local');
    writeFileSync(path.join(dir, 'package.json'), '{not json');
    expect(readBuildChannel(dir)).toBeNull();
  });

  it('claims lingua:// only from release builds unless a developer opts in', () => {
    expect(shouldRegisterProtocolClient('release', false)).toBe(true);
    expect(shouldRegisterProtocolClient('dev', false)).toBe(false);
    expect(shouldRegisterProtocolClient('local', false)).toBe(false);
    expect(shouldRegisterProtocolClient('dev', true)).toBe(true);
  });
});
