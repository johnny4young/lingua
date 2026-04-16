import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function isDesktopSmokeEnabled(): boolean {
  return process.env.LINGUA_DESKTOP_SMOKE === '1';
}

function getArtifactDir(): string | null {
  const artifactDir = process.env.LINGUA_SMOKE_ARTIFACT_DIR;
  return artifactDir ? path.resolve(artifactDir) : null;
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
  ipcMain.handle('desktop-smoke:get-config', async () => ({
    enabled: isDesktopSmokeEnabled(),
    artifactDir: getArtifactDir(),
  }));

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
