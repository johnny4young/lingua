import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rgPath } from '@vscode/ripgrep';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

import {
  searchProjectText,
  type ProjectTextSearchRequest,
} from '../../src/main/ipc/fs/projectTextSearch';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(process.cwd(), '.tmp-project-text-search-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function request(overrides: Partial<ProjectTextSearchRequest> = {}): ProjectTextSearchRequest {
  return {
    searchRootAbsolutePath: projectRoot,
    rootRelativePath: '',
    query: 'needle',
    caseSensitive: false,
    maxMatchesPerFile: 20,
    maxTotalMatches: 500,
    maxFileSize: 1_000_000,
    maxFilesScanned: 5_000,
    ...overrides,
  };
}

describe('projectTextSearch', () => {
  it('keeps ripgrep output equivalent to the JavaScript fallback', async () => {
    await mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await mkdir(path.join(projectRoot, '.hidden'), { recursive: true });
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, 'src', 'unicode.ts'),
      'αβ needle first needle second\n',
      'utf8'
    );
    await writeFile(path.join(projectRoot, '.env'), 'NEEDLE=1\n', 'utf8');
    await writeFile(path.join(projectRoot, '.hidden', 'secret.txt'), 'needle\n', 'utf8');
    await writeFile(path.join(projectRoot, 'node_modules', 'dependency.js'), 'needle\n', 'utf8');
    await writeFile(
      path.join(projectRoot, 'binary.bin'),
      `needle${String.fromCharCode(0)}binary`,
      'utf8'
    );

    const nativeResults = await searchProjectText(request({ ripgrepCandidates: [rgPath] }));
    const fallbackResults = await searchProjectText(
      request({ ripgrepCandidates: ['/definitely/missing/rg'] })
    );

    expect(nativeResults).toEqual(fallbackResults);
    expect(nativeResults.map(result => result.relativePath)).toEqual(['.env', 'src/unicode.ts']);
    expect(nativeResults[1]!.matches).toEqual([
      expect.objectContaining({
        line: 1,
        column: 4,
        matchStart: 3,
        matchEnd: 9,
      }),
    ]);
  });

  it('passes leading-dash queries as literal patterns', async () => {
    await writeFile(path.join(projectRoot, 'flags.txt'), 'prefix -needle suffix\n', 'utf8');

    const results = await searchProjectText(
      request({
        query: '-needle',
        caseSensitive: true,
        ripgrepCandidates: [rgPath],
      })
    );

    expect(results).toEqual([
      {
        relativePath: 'flags.txt',
        matches: [
          expect.objectContaining({
            line: 1,
            column: 8,
            matchStart: 7,
            matchEnd: 14,
          }),
        ],
      },
    ]);
  });

  it('keeps Unicode case folding equivalent across native and fallback search', async () => {
    await writeFile(path.join(projectRoot, 'unicode.txt'), 'ſurface\n', 'utf8');

    const nativeResults = await searchProjectText(
      request({
        query: 's',
        ripgrepCandidates: [rgPath],
      })
    );
    const fallbackResults = await searchProjectText(
      request({
        query: 's',
        ripgrepCandidates: ['/definitely/missing/rg'],
      })
    );

    expect(nativeResults).toEqual(fallbackResults);
    expect(nativeResults).toEqual([
      {
        relativePath: 'unicode.txt',
        matches: [
          expect.objectContaining({
            line: 1,
            column: 1,
            matchStart: 0,
            matchEnd: 1,
          }),
        ],
      },
    ]);
  });

  it('falls back after an executable starts but exits unsuccessfully', async () => {
    await writeFile(path.join(projectRoot, 'main.ts'), 'const needle = true;\n', 'utf8');

    const results = await searchProjectText(
      request({
        ripgrepCandidates: [process.execPath],
      })
    );

    expect(results).toEqual([
      {
        relativePath: 'main.ts',
        matches: [
          expect.objectContaining({
            line: 1,
            column: 7,
          }),
        ],
      },
    ]);
  });

  it('preserves the deterministic file-scan cap before invoking ripgrep', async () => {
    await Promise.all(
      ['a.ts', 'b.ts', 'c.ts'].map(name =>
        writeFile(path.join(projectRoot, name), 'needle\n', 'utf8')
      )
    );

    const results = await searchProjectText(
      request({
        maxFilesScanned: 2,
        ripgrepCandidates: [rgPath],
      })
    );

    expect(results.map(result => result.relativePath)).toEqual(['a.ts', 'b.ts']);
  });

  it('returns no partial results when the request is already canceled', async () => {
    await writeFile(path.join(projectRoot, 'main.ts'), 'needle\n', 'utf8');
    const controller = new AbortController();
    controller.abort();

    await expect(searchProjectText(request({ signal: controller.signal }))).resolves.toEqual([]);
  });
});
