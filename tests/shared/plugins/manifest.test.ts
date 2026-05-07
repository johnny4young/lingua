import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PLUGIN_IDS,
  MANIFEST_FILE_NAME,
  MAX_PLUGIN_ID_LENGTH,
  PLUGIN_API_VERSION,
  PLUGIN_ID_PATTERN,
  PLUGIN_VERSION_PATTERN,
  compareSemver,
  validatePluginManifest,
} from '#src/shared/plugins/manifest';

const ALLOWED_IDS = new Set<string>(BUNDLED_PLUGIN_IDS);

const baseOptions = (overrides: Partial<{ allowedPluginIds: ReadonlySet<string>; appVersion: string }> = {}) => ({
  manifestPath: '/tmp/lingua/plugins/lua/plugin.json',
  installDirectory: '/tmp/lingua/plugins/lua',
  appVersion: '0.2.4',
  allowedPluginIds: overrides.allowedPluginIds ?? ALLOWED_IDS,
  ...(overrides.appVersion ? { appVersion: overrides.appVersion } : {}),
});

describe('manifest constants', () => {
  it('exposes a stable PLUGIN_API_VERSION pinned to 1', () => {
    expect(PLUGIN_API_VERSION).toBe(1);
  });

  it('exposes the canonical manifest filename', () => {
    expect(MANIFEST_FILE_NAME).toBe('plugin.json');
  });

  it('caps pluginId length at 64 characters', () => {
    expect(MAX_PLUGIN_ID_LENGTH).toBe(64);
  });

  it('exposes the strict numeric version pattern used by manifest ranges', () => {
    expect(PLUGIN_VERSION_PATTERN.test('1')).toBe(true);
    expect(PLUGIN_VERSION_PATTERN.test('1.2')).toBe(true);
    expect(PLUGIN_VERSION_PATTERN.test('1.2.3')).toBe(true);
    expect(PLUGIN_VERSION_PATTERN.test('1.2.3-alpha')).toBe(false);
    expect(PLUGIN_VERSION_PATTERN.test('1.2.x')).toBe(false);
  });

  it('declares lua as the only bundled runtime today', () => {
    expect(Array.from(BUNDLED_PLUGIN_IDS)).toEqual(['lua']);
  });
});

describe('PLUGIN_ID_PATTERN', () => {
  it.each([
    ['lua'],
    ['ruby'],
    ['kotlin-native'],
    ['plugin-with-hyphens'],
    ['a'],
    ['1'],
    ['plugin123'],
    ['1plugin'],
    // Exactly 64 chars, all valid characters.
    ['a' + 'b'.repeat(63)],
  ])('accepts %s as a safe pluginId', (id) => {
    expect(PLUGIN_ID_PATTERN.test(id)).toBe(true);
  });

  it.each([
    ['..'],
    ['../foo'],
    ['lua/../foo'],
    ['.hidden'],
    ['Lua'],
    ['LUA'],
    ['my plugin'],
    ['plugin\\with\\slash'],
    ['<script>'],
    ["plugin'name"],
    [''],
    [' '],
    ['\t'],
    // 65 chars — over the cap.
    ['a' + 'b'.repeat(64)],
    ['plugin@home'],
    ['plugin.name'],
  ])('rejects %s as an unsafe pluginId', (id) => {
    expect(PLUGIN_ID_PATTERN.test(id)).toBe(false);
  });
});

describe('compareSemver', () => {
  it('compares versions numerically segment by segment', () => {
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('1.2.0', '1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.1')).toBe(-1);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBe(0);
    expect(compareSemver('1.0.x', '1.0.0')).toBe(0);
  });
});

describe('validatePluginManifest', () => {
  describe('schema and shape', () => {
    it('marks non-object payloads as invalid', () => {
      expect(validatePluginManifest(null, baseOptions()).status).toBe('invalid');
      expect(validatePluginManifest('not an object', baseOptions()).status).toBe('invalid');
      expect(validatePluginManifest(42, baseOptions()).status).toBe('invalid');
      expect(validatePluginManifest([], baseOptions()).status).toBe('invalid');
    });

    it('rejects manifests with unknown top-level fields', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, executable: '/bin/sh' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.message).toMatch(/unknown fields: executable/);
    });

    it('lists every unknown field in the diagnostic', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, executable: '/bin/sh', secret: 'x' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.message).toMatch(/executable/);
      expect(result.message).toMatch(/secret/);
      expect(result.diagnostic).toEqual({
        key: 'unknownFields',
        params: { fields: 'executable, secret' },
      });
    });

    it('accepts a happy-path manifest with all the documented fields', () => {
      const result = validatePluginManifest(
        {
          pluginId: 'lua',
          apiVersion: 1,
          enabled: true,
          minAppVersion: '0.1.0',
          maxAppVersion: '999.0.0',
        },
        baseOptions(),
      );
      expect(result.status).toBe('loaded');
      expect(result.enabled).toBe(true);
    });

    it('marks manifests missing pluginId as invalid', () => {
      const result = validatePluginManifest({ apiVersion: 1 }, baseOptions());
      expect(result.status).toBe('invalid');
      expect(result.message).toMatch(/pluginId/i);
    });

    it('marks manifests with non-string pluginId as invalid', () => {
      const result = validatePluginManifest(
        { pluginId: 42, apiVersion: 1 },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
    });

    it('rejects enabled when it is not a boolean', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, enabled: 'false' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.diagnostic).toEqual({
        key: 'invalidFieldType',
        params: { field: 'enabled', expected: 'boolean' },
      });
    });

    it('rejects apiVersion when it is not numeric', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: '1' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.diagnostic).toEqual({
        key: 'invalidFieldType',
        params: { field: 'apiVersion', expected: 'number' },
      });
    });
  });

  describe('path-safety on pluginId', () => {
    it.each([
      ['..'],
      ['../traversal'],
      ['lua/../bar'],
      ['.hidden'],
      ['Lua'],
      ['my plugin'],
      ['plugin\\with\\slash'],
      ['<script>'],
      ['a'.repeat(65)],
    ])('rejects "%s" with the unsafe-id diagnostic', (pluginId) => {
      const result = validatePluginManifest(
        { pluginId, apiVersion: 1 },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.message).toMatch(/not a safe identifier/);
      expect(result.message).toContain(pluginId);
      expect(result.diagnostic).toEqual({ key: 'unsafeId', params: { pluginId } });
    });

    it('marks empty pluginId as invalid via the missing-pluginId branch', () => {
      // Empty string trips the falsy check before reaching the regex.
      const result = validatePluginManifest(
        { pluginId: '', apiVersion: 1 },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.message).toMatch(/pluginId/);
    });
  });

  describe('apiVersion compatibility', () => {
    it('marks unsupported apiVersion as incompatible', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 2 },
        baseOptions(),
      );
      expect(result.status).toBe('incompatible');
      expect(result.message).toMatch(/expected 1/i);
    });

    it('marks missing apiVersion as incompatible (apiVersion !== 1)', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua' },
        baseOptions(),
      );
      expect(result.status).toBe('incompatible');
    });
  });

  describe('app version range', () => {
    it('rejects malformed minAppVersion strings as invalid schema', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, minAppVersion: '1.2.x' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.diagnostic).toEqual({
        key: 'invalidVersion',
        params: { field: 'minAppVersion' },
      });
    });

    it('rejects malformed maxAppVersion strings as invalid schema', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, maxAppVersion: '1.2.3-alpha' },
        baseOptions(),
      );
      expect(result.status).toBe('invalid');
      expect(result.diagnostic).toEqual({
        key: 'invalidVersion',
        params: { field: 'maxAppVersion' },
      });
    });

    it('marks plugins with minAppVersion above the running app as incompatible', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, minAppVersion: '99.0.0' },
        baseOptions(),
      );
      expect(result.status).toBe('incompatible');
      expect(result.message).toMatch(/>= 99\.0\.0/);
      expect(result.diagnostic).toEqual({
        key: 'minAppVersion',
        params: { minAppVersion: '99.0.0' },
      });
    });

    it('marks plugins with maxAppVersion below the running app as incompatible', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, maxAppVersion: '0.0.1' },
        baseOptions(),
      );
      expect(result.status).toBe('incompatible');
      expect(result.message).toMatch(/<= 0\.0\.1/);
      expect(result.diagnostic).toEqual({
        key: 'maxAppVersion',
        params: { maxAppVersion: '0.0.1' },
      });
    });

    it('accepts a plugin within the app version range', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, minAppVersion: '0.1.0', maxAppVersion: '999.0.0' },
        baseOptions(),
      );
      expect(result.status).toBe('loaded');
    });
  });

  describe('allowlist (unknown vs loaded)', () => {
    it('marks valid manifests with non-bundled pluginIds as unknown', () => {
      const result = validatePluginManifest(
        { pluginId: 'ruby', apiVersion: 1 },
        baseOptions(),
      );
      expect(result.status).toBe('unknown');
      expect(result.message).toMatch(/does not include a plugin named "ruby"/);
      expect(result.diagnostic).toEqual({ key: 'unknown', params: { pluginId: 'ruby' } });
    });

    it('marks unknown ids as unknown EVEN when disabled (security signal wins)', () => {
      // A hostile manifest with `enabled: false` must NOT masquerade
      // as innocuous `disabled`; allowlist check runs first.
      const result = validatePluginManifest(
        { pluginId: 'ruby', apiVersion: 1, enabled: false },
        baseOptions(),
      );
      expect(result.status).toBe('unknown');
      expect(result.status).not.toBe('disabled');
    });

    it('marks disabled plugins from the allowlist as disabled', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1, enabled: false },
        baseOptions(),
      );
      expect(result.status).toBe('disabled');
    });

    it('honours an extended allowlist passed in options', () => {
      const result = validatePluginManifest(
        { pluginId: 'ruby', apiVersion: 1 },
        baseOptions({
          allowedPluginIds: new Set(['lua', 'ruby']),
        }),
      );
      expect(result.status).toBe('loaded');
    });
  });

  describe('happy path', () => {
    it('marks a fully-formed bundled manifest as loaded', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1 },
        baseOptions(),
      );
      expect(result.status).toBe('loaded');
      expect(result.enabled).toBe(true);
      expect(result.message).toMatch(/valid/i);
      expect(result.diagnostic).toEqual({ key: 'loaded' });
    });
  });

  describe('record shape consistency', () => {
    it('always includes manifestPath and installDirectory in the output', () => {
      const result = validatePluginManifest(
        { pluginId: 'lua', apiVersion: 1 },
        baseOptions(),
      );
      expect(result.manifestPath).toBe('/tmp/lingua/plugins/lua/plugin.json');
      expect(result.installDirectory).toBe('/tmp/lingua/plugins/lua');
    });

    it('falls back to the install directory name when pluginId is missing', () => {
      const result = validatePluginManifest({ apiVersion: 1 }, baseOptions());
      // The fallback derives from the install directory's last segment.
      expect(result.pluginId).toBe('lua');
    });
  });
});
