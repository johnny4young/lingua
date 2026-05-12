// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import forgeConfig from '../forge.config';

const FORGE_CONFIG_SOURCE = readFileSync(resolve(__dirname, '../forge.config.ts'), 'utf-8');

describe('forge config', () => {
  it('sets the desktop app category metadata', () => {
    expect(forgeConfig.packagerConfig.appCategoryType).toBe(
      'public.app-category.developer-tools'
    );
  });

  it('registers the lingua protocol in packaged app metadata', () => {
    expect(forgeConfig.packagerConfig.protocols).toEqual([
      {
        name: 'Lingua',
        schemes: ['lingua'],
      },
    ]);
  });

  it('ships branded app icon assets for every packaged platform', () => {
    expect(forgeConfig.packagerConfig.icon).toBe('./assets/icon');
    expect(existsSync(resolve(__dirname, '../assets/icon.icns'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../assets/icon.ico'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../assets/icon.png'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../assets/icon.svg'))).toBe(true);
  });

  it('uses the modern Windows signing hook instead of legacy Squirrel certificate options', () => {
    const makerSquirrelBlock = FORGE_CONFIG_SOURCE.slice(
      FORGE_CONFIG_SOURCE.indexOf('new MakerSquirrel'),
      FORGE_CONFIG_SOURCE.indexOf('new MakerZIP')
    );

    expect(FORGE_CONFIG_SOURCE).toContain('windowsSign');
    expect(FORGE_CONFIG_SOURCE).toContain('WIN_CERT_FILE');
    expect(FORGE_CONFIG_SOURCE).toContain('WIN_CERT_PASSWORD');
    expect(makerSquirrelBlock).toContain('...windowsSign');
    expect(makerSquirrelBlock).not.toContain('certificateFile: process.env.WIN_CERT_FILE');
  });
});
