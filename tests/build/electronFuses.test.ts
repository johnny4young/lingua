import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const builder = load(readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')) as {
  electronFuses?: Record<string, boolean>;
};

describe('electron fuses', () => {
  // The renderer loads from app://lingua; file:// keeps no privileges a page could use
  // to skip CORS or read local files.
  it('ships every fuse hardened, file:// privileges included', () => {
    expect(builder.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });
  });
});
