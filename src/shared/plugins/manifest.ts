/**
 * RL-084 — Local plugin manifest contract.
 *
 * Single source of truth for the plugin manifest schema, the bundled
 * runtime allowlist, and the validator function. Pure module — no
 * Electron, no React, no Node-only APIs — so it imports cleanly from
 * `src/main/plugins.ts`, `src/renderer/plugins/catalog.ts`, the
 * renderer store, and any test surface.
 *
 * The validator enforces the policy the product promises (manifest-
 * only enablement, no arbitrary plugin executable code) by:
 *
 *   1. Strict JSON schema — only the documented fields are allowed.
 *   2. Path-safety regex on `pluginId` — rejects path traversal,
 *      hidden prefixes, whitespace, special chars, and overlong ids.
 *   3. Bundled-runtime allowlist — manifests with valid shape but
 *      unknown ids surface as a dedicated `unknown` status (NOT
 *      `loaded`), so the user can tell apart "this plugin file is
 *      malformed" from "this build does not include this plugin".
 */

/** Shapes the validator emits for the renderer to render. */
export type PluginInstallStatus =
  | 'loaded'
  | 'disabled'
  | 'invalid'
  | 'incompatible'
  | 'unavailable'
  | 'unknown';

/** Canonical manifest shape after parse. Validator emits this. */
export interface InstalledPluginManifest {
  pluginId: string;
  apiVersion: 1;
  enabled?: boolean;
  minAppVersion?: string;
  maxAppVersion?: string;
}

export type PluginDiagnosticKey =
  | 'manifestObject'
  | 'unknownFields'
  | 'missingPluginId'
  | 'unsafeId'
  | 'invalidFieldType'
  | 'invalidVersion'
  | 'unsupportedApiVersion'
  | 'minAppVersion'
  | 'maxAppVersion'
  | 'unknown'
  | 'disabled'
  | 'loaded'
  | 'loadFailed'
  | 'unavailable';

export interface PluginDiagnostic {
  key: PluginDiagnosticKey;
  params?: Record<string, string | number | boolean | null>;
}

/** What the main IPC returns per discovered plugin directory. */
export interface InstalledPluginRecord {
  pluginId: string;
  manifestPath: string;
  installDirectory: string;
  apiVersion: number | null;
  enabled: boolean;
  status: PluginInstallStatus;
  message: string;
  diagnostic?: PluginDiagnostic;
}

/** Current manifest schema version. Bump only with a migration plan. */
export const PLUGIN_API_VERSION = 1 as const;

/** Filename the discovery scan looks for inside each plugin directory. */
export const MANIFEST_FILE_NAME = 'plugin.json';

/**
 * Bundled runtimes this build knows how to load. Source of truth for
 * both main (validator allowlist) and renderer (loader map keys).
 *
 * To bundle a new runtime: append the id here AND add a loader entry
 * in `src/renderer/plugins/catalog.ts`. The catalog test asserts the
 * two stay in sync.
 */
export const BUNDLED_PLUGIN_IDS = ['lua'] as const;
export type BundledPluginId = (typeof BUNDLED_PLUGIN_IDS)[number];

/**
 * Path-safety pattern. Lowercase alphanumeric + hyphen, must start
 * with alphanumeric, max 64 chars. This rejects:
 *
 *   - `..`, `../foo`, `lua/../bar` (path traversal attempts)
 *   - `.hidden` (hidden-file prefix)
 *   - `Lua` (uppercase — manifests must use canonical lowercase ids)
 *   - `My Plugin`, `plugin\\with\\slash`, `<script>` (special chars)
 *   - empty string
 *   - any id over 64 chars
 */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const MAX_PLUGIN_ID_LENGTH = 64;
export const PLUGIN_VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/u;

const ALLOWED_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'pluginId',
  'apiVersion',
  'enabled',
  'minAppVersion',
  'maxAppVersion',
]);

/**
 * Numeric semver comparator. Compares dot-separated integer segments;
 * non-numeric segments are ignored (treated as 0). Sufficient for the
 * `minAppVersion` / `maxAppVersion` use case. Not a full semver parser.
 */
export function compareSemver(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    const lhs = left[index] ?? 0;
    const rhs = right[index] ?? 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }

  return 0;
}

function hasOwn(candidate: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(candidate, key);
}

function isValidManifestVersion(value: unknown): value is string {
  return typeof value === 'string' && PLUGIN_VERSION_PATTERN.test(value);
}

export interface ValidatePluginManifestOptions {
  manifestPath: string;
  installDirectory: string;
  appVersion: string;
  /** The set of pluginIds this build includes a bundled runtime for. */
  allowedPluginIds: ReadonlySet<string>;
}

/**
 * Validate a parsed manifest payload. Returns a fully-shaped
 * InstalledPluginRecord regardless of outcome — the `status` field is
 * the tag and `message` is the human-readable diagnostic.
 *
 * Order of checks (deliberate):
 *
 *   1. Type / null guard — manifest must be an object.
 *   2. Strict schema — reject unknown top-level fields.
 *   3. pluginId presence + type.
 *   4. pluginId path-safety — regex.
 *   5. apiVersion match.
 *   6. minAppVersion / maxAppVersion compatibility.
 *   7. Allowlist check — UNKNOWN before disabled, so a hostile
 *      manifest with `enabled: false` doesn't masquerade as an
 *      innocuous disabled plugin.
 *   8. Disabled flag.
 *
 * Each branch returns immediately with a distinct status + message.
 */
export function validatePluginManifest(
  manifest: unknown,
  options: ValidatePluginManifestOptions,
): InstalledPluginRecord {
  const { manifestPath, installDirectory, appVersion, allowedPluginIds } = options;
  const fallbackId = installDirectoryName(installDirectory);

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      pluginId: fallbackId,
      manifestPath,
      installDirectory,
      apiVersion: null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest must be a JSON object.',
      diagnostic: { key: 'manifestObject' },
    };
  }

  // Strict schema — reject any unknown top-level field. This catches
  // both honest mistakes ("did you mean apiVersion not api_version?")
  // and hostile injection attempts ("executable: '/bin/sh'").
  const candidate = manifest as Record<string, unknown>;
  const unknownFields = Object.keys(candidate).filter(
    (key) => !ALLOWED_MANIFEST_KEYS.has(key),
  );
  if (unknownFields.length > 0) {
    return {
      pluginId: typeof candidate.pluginId === 'string' ? candidate.pluginId : fallbackId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: `Manifest contains unknown fields: ${unknownFields.join(', ')}.`,
      diagnostic: { key: 'unknownFields', params: { fields: unknownFields.join(', ') } },
    };
  }

  if (!candidate.pluginId || typeof candidate.pluginId !== 'string') {
    return {
      pluginId: fallbackId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest must declare a string pluginId.',
      diagnostic: { key: 'missingPluginId' },
    };
  }

  const pluginId = candidate.pluginId;

  // Path-safety check on pluginId. Rejects `..`, `.hidden`, `/`, `\`,
  // uppercase, whitespace, special chars, and overlong ids.
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: `Plugin id "${pluginId}" is not a safe identifier (use a-z, 0-9, hyphen).`,
      diagnostic: { key: 'unsafeId', params: { pluginId } },
    };
  }

  if (hasOwn(candidate, 'enabled') && typeof candidate.enabled !== 'boolean') {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest field enabled must be a boolean.',
      diagnostic: { key: 'invalidFieldType', params: { field: 'enabled', expected: 'boolean' } },
    };
  }

  if (hasOwn(candidate, 'minAppVersion') && !isValidManifestVersion(candidate.minAppVersion)) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest field minAppVersion must be a numeric version string like 1.2.3.',
      diagnostic: { key: 'invalidVersion', params: { field: 'minAppVersion' } },
    };
  }

  if (hasOwn(candidate, 'maxAppVersion') && !isValidManifestVersion(candidate.maxAppVersion)) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest field maxAppVersion must be a numeric version string like 1.2.3.',
      diagnostic: { key: 'invalidVersion', params: { field: 'maxAppVersion' } },
    };
  }

  if (hasOwn(candidate, 'apiVersion') && typeof candidate.apiVersion !== 'number') {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest field apiVersion must be a number.',
      diagnostic: { key: 'invalidFieldType', params: { field: 'apiVersion', expected: 'number' } },
    };
  }

  if (candidate.apiVersion !== PLUGIN_API_VERSION) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin API version ${String(candidate.apiVersion)} is not supported. Expected ${PLUGIN_API_VERSION}.`,
      diagnostic: {
        key: 'unsupportedApiVersion',
        params: {
          apiVersion: candidate.apiVersion === undefined ? 'missing' : String(candidate.apiVersion),
          expectedApiVersion: PLUGIN_API_VERSION,
        },
      },
    };
  }

  if (typeof candidate.minAppVersion === 'string' && compareSemver(appVersion, candidate.minAppVersion) < 0) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin requires app version >= ${candidate.minAppVersion}.`,
      diagnostic: { key: 'minAppVersion', params: { minAppVersion: candidate.minAppVersion } },
    };
  }

  if (typeof candidate.maxAppVersion === 'string' && compareSemver(appVersion, candidate.maxAppVersion) > 0) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin requires app version <= ${candidate.maxAppVersion}.`,
      diagnostic: { key: 'maxAppVersion', params: { maxAppVersion: candidate.maxAppVersion } },
    };
  }

  // Allowlist check runs BEFORE the disabled check. A manifest with
  // a hostile id and `enabled: false` should still surface as
  // `unknown` (security signal), not as `disabled` (innocuous).
  if (!allowedPluginIds.has(pluginId)) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: candidate.enabled !== false,
      status: 'unknown',
      message: `This build does not include a plugin named "${pluginId}".`,
      diagnostic: { key: 'unknown', params: { pluginId } },
    };
  }

  if (candidate.enabled === false) {
    return {
      pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: false,
      status: 'disabled',
      message: 'Plugin is installed but disabled in its manifest.',
      diagnostic: { key: 'disabled' },
    };
  }

  return {
    pluginId,
    manifestPath,
    installDirectory,
    apiVersion: candidate.apiVersion,
    enabled: true,
    status: 'loaded',
    message: 'Plugin manifest is valid.',
    diagnostic: { key: 'loaded' },
  };
}

/**
 * Extract the directory name from a path-like string. Used as the
 * fallback `pluginId` when the manifest is malformed and we have no
 * better identifier to surface in the diagnostic. Pure string work —
 * no `path` module dependency so this stays renderer-safe.
 */
function installDirectoryName(installDirectory: string): string {
  // Trim trailing separator, then take the last segment.
  const trimmed = installDirectory.replace(/[/\\]+$/, '');
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}
