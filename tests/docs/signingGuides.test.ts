import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MACOS_SIGNING_PATH = resolve(ROOT, 'docs/MACOS_SIGNING.md');
const WINDOWS_SIGNING_PATH = resolve(ROOT, 'docs/WINDOWS_SIGNING.md');

describe('desktop signing guides', () => {
  const macosGuide = existsSync(MACOS_SIGNING_PATH)
    ? readFileSync(MACOS_SIGNING_PATH, 'utf-8')
    : '';
  const windowsGuide = existsSync(WINDOWS_SIGNING_PATH)
    ? readFileSync(WINDOWS_SIGNING_PATH, 'utf-8')
    : '';

  it('documents every macOS signing secret required by release.yml', () => {
    for (const secret of [
      'APPLE_ID',
      'APPLE_ID_PASSWORD',
      'APPLE_TEAM_ID',
      'APPLE_CERT_P12_BASE64',
      'APPLE_CERT_PASSWORD',
    ]) {
      expect(macosGuide).toContain(secret);
    }
    expect(macosGuide).toContain('Developer ID Application');
    expect(macosGuide).toContain('notarization');
  });

  it('documents the active Windows PFX path, validation, and HSM escape hatch', () => {
    for (const secret of ['WIN_CERT_FILE', 'WIN_CERT_PASSWORD']) {
      expect(windowsGuide).toContain(secret);
    }
    expect(windowsGuide).toContain('scripts/validate-windows-package.mjs');
    expect(windowsGuide).toContain('unsigned preview build');
    expect(windowsGuide).toContain('Get-AuthenticodeSignature');
    expect(windowsGuide).toMatch(/HSM|cloud-managed signing|Artifact Signing/u);
  });
});
