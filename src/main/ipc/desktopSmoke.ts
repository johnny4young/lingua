import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getBlockedOfflineSmokeUrls,
  isOfflineSmokeRequested,
} from '../offlineSmoke';

const DESKTOP_SMOKE_FLAG = '--lingua-desktop-smoke';
const SMOKE_ARTIFACT_DIR_PREFIX = '--lingua-smoke-artifact-dir=';
const SMOKE_LAUNCHED_AT_ENV = 'LINGUA_SMOKE_LAUNCHED_AT_MS';

function isDesktopSmokeEnabled(): boolean {
  return (
    process.env.LINGUA_DESKTOP_SMOKE === '1' ||
    process.argv.includes(DESKTOP_SMOKE_FLAG)
  );
}

/**
 * RL-080 Slice 3 — packaged-subset gate. When the smoke harness is
 * launched against a release artifact (the `.app` bundle on macOS),
 * we run a reduced 2-case subset (javascript + python) instead of the
 * full 9-case matrix. The full matrix already runs against the dev
 * server in `npm run smoke:desktop`; the packaged run is a release
 * gate that proves the binary boots and the runtime-critical paths
 * (renderer load + Pyodide vendored offline) still work end-to-end.
 */
function isPackagedSubsetRequested(): boolean {
  return process.env.LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET === '1';
}

function getArtifactDir(): string | null {
  const artifactDir =
    process.env.LINGUA_SMOKE_ARTIFACT_DIR ??
    process.argv
      .find((arg) => arg.startsWith(SMOKE_ARTIFACT_DIR_PREFIX))
      ?.slice(SMOKE_ARTIFACT_DIR_PREFIX.length);
  return artifactDir ? path.resolve(artifactDir) : null;
}

function getLaunchedAtMs(): number | null {
  const value = process.env[SMOKE_LAUNCHED_AT_ENV];
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeArtifactName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'artifact';
}

async function ensureArtifactDir(): Promise<string | null> {
  const artifactDir = getArtifactDir();
  if (!artifactDir) {
    return null;
  }

  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

export function registerDesktopSmokeHandlers(): void {
  ipcMain.handle('desktop-smoke:get-config', async () => {
    const launchedAtMs = getLaunchedAtMs();

    return {
      enabled: isDesktopSmokeEnabled(),
      artifactDir: getArtifactDir(),
      offline: isOfflineSmokeRequested(),
      packagedSubset: isPackagedSubsetRequested(),
      ...(launchedAtMs === null ? {} : { launchedAtMs }),
    };
  });

  ipcMain.handle('desktop-smoke:get-offline-blocks', async () => {
    if (!isDesktopSmokeEnabled() || !isOfflineSmokeRequested()) {
      return [];
    }
    return getBlockedOfflineSmokeUrls();
  });

  ipcMain.handle('desktop-smoke:get-memory-snapshot', async () => {
    if (!isDesktopSmokeEnabled()) {
      return { ok: false, reason: 'smoke-disabled' };
    }

    if (typeof process.memoryUsage !== 'function') {
      return { ok: false, reason: 'unsupported' };
    }

    const processMemory = process.memoryUsage();
    const appMetrics =
      typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : [];

    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      process: {
        rssBytes: processMemory.rss,
        heapTotalBytes: processMemory.heapTotal,
        heapUsedBytes: processMemory.heapUsed,
        externalBytes: processMemory.external,
        arrayBuffersBytes: processMemory.arrayBuffers,
      },
      chromium: appMetrics.map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        workingSetSizeBytes: metric.memory.workingSetSize * 1024,
        peakWorkingSetSizeBytes: metric.memory.peakWorkingSetSize * 1024,
        privateBytes: metric.memory.privateBytes,
      })),
    };
  });

  ipcMain.handle('desktop-smoke:capture', async (event, name: string) => {
    if (!isDesktopSmokeEnabled()) {
      return null;
    }

    const artifactDir = await ensureArtifactDir();
    if (!artifactDir) {
      return null;
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return null;
    }

    const image = await window.capturePage();
    const filePath = path.join(artifactDir, `${sanitizeArtifactName(name)}.png`);
    await writeFile(filePath, image.toPNG());
    return filePath;
  });

  ipcMain.handle('desktop-smoke:write-json-artifact', async (_event, name: string, payload: unknown) => {
    if (!isDesktopSmokeEnabled()) {
      return null;
    }

    const artifactDir = await ensureArtifactDir();
    if (!artifactDir) {
      return null;
    }

    const filePath = path.join(artifactDir, sanitizeArtifactName(name));
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  });

  ipcMain.on('desktop-smoke:finish', (_event, success: boolean) => {
    if (!isDesktopSmokeEnabled()) {
      return;
    }

    setImmediate(() => {
      app.exit(success ? 0 : 1);
    });
  });
}

export { sanitizeArtifactName };
