import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FOOTPRINT_TOOL = '/usr/bin/footprint';
const FOOTPRINT_TIMEOUT_MS = 15_000;

/**
 * Footprint in bytes per pid, the figure Activity Monitor shows as Memory.
 * Working set leaves out compressed pages and GPU surfaces, so a 100 MB
 * regression can hide in it. macOS only: resolves null elsewhere or on failure.
 */
export async function readProcessFootprints(
  pids: readonly number[]
): Promise<Map<number, number> | null> {
  if (process.platform !== 'darwin' || pids.length === 0) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lingua-footprint-'));
  const output = path.join(dir, 'footprint.json');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        FOOTPRINT_TOOL,
        ['--json', output, '--format', 'bytes', '--noCategories', ...pids.map(String)],
        { timeout: FOOTPRINT_TIMEOUT_MS },
        error => (error ? reject(error) : resolve())
      );
    });
    const parsed = JSON.parse(await readFile(output, 'utf8')) as {
      processes?: Array<{ pid?: unknown; footprint?: unknown }>;
    };
    const footprints = new Map<number, number>();
    for (const entry of parsed.processes ?? []) {
      if (typeof entry.pid === 'number' && typeof entry.footprint === 'number') {
        footprints.set(entry.pid, entry.footprint);
      }
    }
    return footprints;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
