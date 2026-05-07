import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  renderMarkdownReport,
  validateDarwinPayload,
  validateUpdateFeed,
  validateWin32Payload,
} from '../../scripts/validate-update-feed.mjs';

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function createResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe('validate-update-feed', () => {
  it('validates the Squirrel.Mac JSON payload', () => {
    expect(
      validateDarwinPayload(
        {
          url: 'https://signed.example/Lingua-0.2.5-darwin.zip',
          name: 'Lingua v0.2.5',
          pub_date: '2026-05-07T00:00:00Z',
        },
        '0.2.5'
      )
    ).toEqual({
      versionEvidence: 'Lingua v0.2.5',
      assetEvidence: 'https://signed.example/Lingua-0.2.5-darwin.zip',
    });
  });

  it('rejects darwin payloads that do not reference the expected version', () => {
    expect(() =>
      validateDarwinPayload(
        {
          url: 'https://signed.example/Lingua-0.2.4-darwin.zip',
          name: 'Lingua v0.2.4',
          pub_date: '2026-05-07T00:00:00Z',
        },
        '0.2.5'
      )
    ).toThrow(/does not reference 0\.2\.5/u);
  });

  it('validates rewritten Windows RELEASES payloads', () => {
    expect(
      validateWin32Payload(
        'ABCDEF https://updates.example.com/download/123/Lingua-0.2.5-full.nupkg 456\n',
        '0.2.5'
      )
    ).toEqual({
      versionEvidence: '0.2.5',
      assetEvidence: '1 RELEASES line(s)',
    });
  });

  it('rejects Windows RELEASES lines that still expose raw filenames', () => {
    expect(() => validateWin32Payload('ABCDEF Lingua-0.2.5-full.nupkg 456\n', '0.2.5')).toThrow(
      /download proxy/u
    );
  });

  it('accepts 204 no-update responses when no expected version is required', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const report = await validateUpdateFeed({
      oldVersion: '0.2.4',
      platforms: ['darwin'],
      fetchImpl,
      writeArtifacts: false,
    });

    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({
      platform: 'darwin',
      status: 204,
      versionEvidence: 'no-update',
    });
  });

  it('fails 204 no-update responses when an expected version is required', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const report = await validateUpdateFeed({
      oldVersion: '0.2.4',
      expectedVersion: '0.2.5',
      platforms: ['darwin'],
      fetchImpl,
      writeArtifacts: false,
    });

    expect(report.ok).toBe(false);
    expect(report.results[0].error).toContain('Expected 0.2.5');
  });

  it('checks both platform feed shapes and writes evidence artifacts', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-update-feed-'));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/darwin/')) {
        return createResponse(
          JSON.stringify({
            url: 'https://signed.example/Lingua-0.2.5-darwin.zip',
            name: 'Lingua v0.2.5',
            pub_date: '2026-05-07T00:00:00Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return createResponse(
        'ABCDEF https://updates.example.com/download/123/Lingua-0.2.5-full.nupkg 456\n',
        { status: 200, headers: { 'content-type': 'text/plain' } }
      );
    });

    const report = await validateUpdateFeed({
      baseUrl: 'https://updates.example.com',
      oldVersion: '0.2.4',
      expectedVersion: '0.2.5',
      platforms: ['darwin', 'win32'],
      outputDir: tempRoot,
      fetchImpl,
    });

    expect(report.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(tempRoot, 'update-feed-validation.json'), 'utf8')).toContain(
      '"expectedVersion": "0.2.5"'
    );
    expect(await readFile(path.join(tempRoot, 'update-feed-validation.md'), 'utf8')).toContain(
      'Desktop update feed validation'
    );
  });

  it('rejects malformed versions before fetching', async () => {
    const fetchImpl = vi.fn();

    await expect(
      validateUpdateFeed({
        oldVersion: '0.2',
        platforms: ['darwin'],
        fetchImpl,
        writeArtifacts: false,
      })
    ).rejects.toThrow(/old-version/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renders a markdown summary table', () => {
    expect(
      renderMarkdownReport({
        generatedAt: '2026-05-07T00:00:00.000Z',
        results: [
          {
            platform: 'darwin',
            status: 200,
            ok: true,
            versionEvidence: 'Lingua v0.2.5',
            assetEvidence: 'https://signed.example/Lingua-0.2.5-darwin.zip',
          },
        ],
      })
    ).toContain('| darwin | 200 | pass | Lingua v0.2.5 |');
  });
});
