import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const builder = load(readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')) as {
  electronLanguages?: string[];
};

describe('packaged Chromium locales', () => {
  it('keeps the UI languages under both the macOS .lproj and the .pak names', () => {
    expect(builder.electronLanguages).toEqual(
      expect.arrayContaining(['en', 'es', 'es_419', 'en_GB', 'en-US', 'es-419', 'en-GB'])
    );
  });

  it('keeps en-US, the .pak Chromium falls back to on Windows and Linux', () => {
    expect(builder.electronLanguages).toContain('en-US');
  });
});
