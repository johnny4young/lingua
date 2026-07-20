/**
 * implementation note — `fs:searchInFiles` substring latency
 * defense.
 *
 * The main-process handler in `src/main/ipc/fileSystem.ts:670` reads
 * each file, splits on newlines, and runs `indexOf` per line — pure
 * substring, no regex. A future work that promotes the handler to
 * regex / glob support would change the algorithmic complexity; this
 * bench locks the substring path so we notice. Mirrors the
 * `consoleRich.bench.test.ts` pattern (single-iteration ceiling).
 *
 * Budget: 300 ms wall clock to scan 200 synthetic files of ~80 lines
 * each, applying the same per-file (20) + total (500) match cap the
 * real handler uses. CI flake margin × 1.5 (consistent with
 * `projectTreeRender.bench.test.ts`).
 */

import { mkdtemp, rm, writeFile, readFile, readdir, stat as statAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const FILE_COUNT = 200;
const LINES_PER_FILE = 80;
const BUDGET_MS = process.env.CI === 'true' ? 450 : 300;

let workDir = '';

async function buildFixture(): Promise<void> {
  workDir = await mkdtemp(path.join(tmpdir(), 'lingua-search-bench-'));
  for (let i = 0; i < FILE_COUNT; i += 1) {
    const lines: string[] = [];
    for (let l = 0; l < LINES_PER_FILE; l += 1) {
      // Sprinkle the needle on ~1 in 8 lines so the search has
      // realistic hits + misses.
      if (l % 8 === 0) {
        lines.push(`// TODO: review function helper-${i}-${l}`);
      } else {
        lines.push(`const value_${i}_${l} = "lorem ipsum dolor sit amet";`);
      }
    }
    await writeFile(
      path.join(workDir, `file-${i}.ts`),
      lines.join('\n'),
      'utf-8'
    );
  }
}

interface Match {
  line: number;
  column: number;
}

// Pure-JS mirror of the substring + budgets algorithm in
// `fs:searchInFiles`. Kept inline so the bench tests the same
// algorithmic shape without depending on Electron's ipcMain.
async function runSubstringSearch(rootDir: string, needle: string): Promise<number> {
  const maxMatchesPerFile = 20;
  const maxTotalMatches = 500;
  const maxFileSize = 1_000_000;
  let totalMatches = 0;
  const NUL = String.fromCharCode(0);

  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (totalMatches >= maxTotalMatches) break;
    if (!entry.isFile()) continue;
    const filePath = path.join(rootDir, entry.name);
    const info = await statAsync(filePath);
    if (info.size > maxFileSize) continue;
    const content = await readFile(filePath, 'utf-8');
    if (content.slice(0, 1024).includes(NUL)) continue;
    const fileMatches: Match[] = [];
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (fileMatches.length >= maxMatchesPerFile) break;
      if (totalMatches + fileMatches.length >= maxTotalMatches) break;
      const haystack = lines[lineIndex]!.toLowerCase();
      const column = haystack.indexOf(needle);
      if (column === -1) continue;
      fileMatches.push({ line: lineIndex + 1, column: column + 1 });
    }
    totalMatches += fileMatches.length;
  }
  return totalMatches;
}

beforeAll(async () => {
  await buildFixture();
}, 30_000);

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe(`fs:searchInFiles substring bench — ${BUDGET_MS} ms budget for 200 files`, () => {
  it('runs the substring scan over a 200-file fixture under budget', async () => {
    // Warm-up — let the filesystem page cache settle before measuring.
    await runSubstringSearch(workDir, 'todo');

    const now = () =>
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const startMs = now();
    const totalMatches = await runSubstringSearch(workDir, 'todo');
    const elapsedMs = now() - startMs;

    expect(totalMatches).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  });
});
