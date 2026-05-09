import { app, ipcMain } from 'electron';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLED_PLUGIN_IDS,
  MANIFEST_FILE_NAME,
  compareSemver,
  validatePluginManifest,
} from '../shared/plugins/manifest';

/**
 * RL-084 — main-side plugin discovery.
 *
 * Reads `<userData>/plugins/<id>/plugin.json` and runs each through
 * the shared validator (`src/shared/plugins/manifest.ts`). The shared
 * module owns the schema, the bundled-runtime allowlist, and the
 * path-safety regex; this file only handles disk I/O + IPC plumbing.
 */

/**
 * Allowlist of bundled runtimes the validator consults. Wrapped in a
 * Set so the validator's `O(1)` membership check is cheap. Mirrors
 * the loader-map keys in `src/renderer/plugins/catalog.ts`; the
 * shared module's `BUNDLED_PLUGIN_IDS` is the single source of truth
 * for both.
 */
const ALLOWED_PLUGIN_IDS: ReadonlySet<string> = new Set(BUNDLED_PLUGIN_IDS);
const MAX_PLUGIN_SCAN_ENTRIES = 100;
const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024;

export function getPluginInstallDirectory(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function validateManifest(
  manifest: unknown,
  manifestPath: string,
  appVersion: string,
): InstalledPluginRecord {
  return validatePluginManifest(manifest, {
    manifestPath,
    installDirectory: path.dirname(manifestPath),
    appVersion,
    allowedPluginIds: ALLOWED_PLUGIN_IDS,
  });
}

export async function listInstalledPlugins(
  pluginDirectory = getPluginInstallDirectory(),
  appVersion = app.getVersion(),
): Promise<InstalledPluginRecord[]> {
  await mkdir(pluginDirectory, { recursive: true });
  const entries = (await readdir(pluginDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_PLUGIN_SCAN_ENTRIES);
  const results: InstalledPluginRecord[] = [];

  for (const entry of entries) {
    const installDirectory = path.join(pluginDirectory, entry.name);
    const manifestPath = path.join(installDirectory, MANIFEST_FILE_NAME);

    try {
      const manifestStat = await stat(manifestPath);
      if (!manifestStat.isFile()) {
        throw new Error('plugin manifest is not a regular file');
      }
      if (manifestStat.size > MAX_PLUGIN_MANIFEST_BYTES) {
        throw new Error(
          `plugin manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} byte limit`
        );
      }
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      results.push(validateManifest(parsed, manifestPath, appVersion));
    } catch (error) {
      results.push({
        pluginId: entry.name,
        manifestPath,
        installDirectory,
        apiVersion: null,
        enabled: false,
        status: 'invalid',
        message:
          error instanceof Error
            ? `Failed to load plugin manifest: ${error.message}`
            : 'Failed to load plugin manifest.',
        diagnostic: {
          key: 'loadFailed',
          params: {
            errorMessage: error instanceof Error ? error.message : 'unknown error',
          },
        },
      });
    }
  }

  return results.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

export function registerPluginHandlers(): void {
  ipcMain.handle('plugins:get-install-directory', async () => getPluginInstallDirectory());
  ipcMain.handle('plugins:list', async () => listInstalledPlugins());
}

export const pluginManifestHelpers = {
  compareVersions: compareSemver,
  validateManifest,
};
