import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMarkdownSummary,
  findLinuxPackageArtifacts,
} from '../../scripts/validate-linux-release-artifacts.mjs';

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('validate-linux-release-artifacts', () => {
  it('finds Debian and RPM packages under the Forge output tree', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lingua-linux-artifacts-'));
    const debDir = join(tempRoot, 'deb', 'x64');
    const rpmDir = join(tempRoot, 'rpm', 'x64');
    await mkdir(debDir, { recursive: true });
    await mkdir(rpmDir, { recursive: true });
    await writeFile(join(debDir, 'lingua_0.2.4_amd64.deb'), '');
    await writeFile(join(rpmDir, 'lingua-0.2.4.x86_64.rpm'), '');

    const artifacts = await findLinuxPackageArtifacts(tempRoot);

    expect(artifacts.deb).toBe(join(debDir, 'lingua_0.2.4_amd64.deb'));
    expect(artifacts.rpm).toBe(join(rpmDir, 'lingua-0.2.4.x86_64.rpm'));
  });

  it('renders release evidence with install and uninstall results', () => {
    const markdown = buildMarkdownSummary({
      generatedAt: '2026-05-07T00:00:00.000Z',
      deb: { path: '/tmp/lingua.deb' },
      rpm: { path: '/tmp/lingua.rpm' },
      installSmoke: {
        binaryPath: '/usr/bin/lingua',
        caseCount: 2,
        failureCount: 0,
        uninstallVerified: true,
      },
    });

    expect(markdown).toContain('# Linux package validation');
    expect(markdown).toContain('/tmp/lingua.deb');
    expect(markdown).toContain('/tmp/lingua.rpm');
    expect(markdown).toContain('/usr/bin/lingua');
    expect(markdown).toContain('2 case(s), 0 failure(s)');
    expect(markdown).toContain('| Uninstall | verified |');
  });
});
