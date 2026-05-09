/**
 * RL-077 Slice 1 — capability registry unit tests.
 *
 * Pins the contract `resolveCapabilityPath` enforces before every
 * filesystem IPC handler is migrated onto it (Slice 2):
 *
 *   - Mint produces a token tied to a canonical absolute path.
 *   - Lookup / revoke round-trip cleanly and are idempotent.
 *   - resolveCapabilityPath returns the canonical absolute path for
 *     valid `{ rootId, relativePath }` pairs.
 *   - Empty relative path resolves to the root itself.
 *   - Unknown rootId, malformed path shapes, traversal (`..`),
 *     absolute path injection, Windows device prefix, protected paths,
 *     and symlink-out attempts all reject before any disk I/O.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  clearRegistryForTests,
  lookupRoot,
  mintFileCapability,
  mintRootCapability,
  resolveCapabilityPath,
  revokeRoot,
} from '../../src/main/ipc/projectCapabilities';

let tmpRoot: string;
const repoTmpPrefix = path.join(process.cwd(), '.tmp-lingua-cap-');

beforeEach(async () => {
  clearRegistryForTests();
  tmpRoot = await mkdtemp(repoTmpPrefix);
});

afterEach(async () => {
  clearRegistryForTests();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('mintRootCapability + lookupRoot + revokeRoot', () => {
  it('mints a unique opaque rootId for a given absolute path', () => {
    const a = mintRootCapability(tmpRoot);
    const b = mintRootCapability(tmpRoot);
    expect(a.rootId).not.toBe(b.rootId);
    expect(a.rootPath).toBe(path.normalize(path.resolve(tmpRoot)));
    expect(b.rootPath).toBe(a.rootPath);
  });

  it('lookupRoot returns the canonical rootPath for a known token', () => {
    const { rootId, rootPath } = mintRootCapability(tmpRoot);
    expect(lookupRoot(rootId)).toEqual({ rootPath });
  });

  it('lookupRoot returns null for unknown / revoked tokens', () => {
    expect(lookupRoot('not-a-real-token')).toBeNull();

    const { rootId } = mintRootCapability(tmpRoot);
    expect(revokeRoot(rootId)).toBe(true);
    expect(lookupRoot(rootId)).toBeNull();
    // Idempotent.
    expect(revokeRoot(rootId)).toBe(false);
  });
});

describe('resolveCapabilityPath happy path', () => {
  it('resolves an empty relative path to the root itself', async () => {
    const { rootId, rootPath } = mintRootCapability(tmpRoot);
    const realRoot = path.normalize(await realpath(tmpRoot));
    const result = await resolveCapabilityPath(rootId, '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // resolveCapabilityPath returns the realpath-resolved absolute
      // path so symlink-out attempts can be detected; the rootPath
      // field returns the canonical (un-realpathed) approval value
      // the renderer originally saw.
      expect(result.absolutePath).toBe(realRoot);
      expect(result.rootPath).toBe(rootPath);
    }
  });

  it('resolves a nested relative path inside the root', async () => {
    await mkdir(path.join(tmpRoot, 'src'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'src', 'foo.ts'), 'export {};\n');

    const { rootId } = mintRootCapability(tmpRoot);
    const realRoot = path.normalize(await realpath(tmpRoot));
    const result = await resolveCapabilityPath(rootId, 'src/foo.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath).toBe(path.join(realRoot, 'src', 'foo.ts'));
    }
  });

  it('resolves a write target that does not yet exist by walking up to an existing ancestor', async () => {
    await mkdir(path.join(tmpRoot, 'src'), { recursive: true });
    const { rootId } = mintRootCapability(tmpRoot);
    const realRoot = path.normalize(await realpath(tmpRoot));
    const result = await resolveCapabilityPath(rootId, 'src/new-file.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath).toBe(path.join(realRoot, 'src', 'new-file.ts'));
    }
  });
});

describe('single-file capabilities', () => {
  it('resolves only the explicitly approved file', async () => {
    await writeFile(path.join(tmpRoot, 'picked.txt'), 'ok', 'utf-8');
    await writeFile(path.join(tmpRoot, 'sibling.txt'), 'no', 'utf-8');

    const { rootId, rootPath, fileRelativePath } = mintFileCapability(
      path.join(tmpRoot, 'picked.txt')
    );
    expect(rootPath).toBe(path.normalize(tmpRoot));
    expect(fileRelativePath).toBe('picked.txt');

    const allowed = await resolveCapabilityPath(rootId, 'picked.txt');
    expect(allowed.ok).toBe(true);

    await expect(resolveCapabilityPath(rootId, 'sibling.txt')).resolves.toEqual({
      ok: false,
      error: 'unsafe-path',
    });
    await expect(resolveCapabilityPath(rootId, '')).resolves.toEqual({
      ok: false,
      error: 'unsafe-path',
    });
  });
});

describe('resolveCapabilityPath rejection paths', () => {
  it('rejects unknown rootId', async () => {
    const result = await resolveCapabilityPath('does-not-exist', 'foo.txt');
    expect(result).toEqual({ ok: false, error: 'unknown-root' });
  });

  it('rejects malformed root ids and relative paths without throwing', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    await expect(resolveCapabilityPath(null, 'foo.txt')).resolves.toEqual({
      ok: false,
      error: 'unknown-root',
    });
    await expect(resolveCapabilityPath(rootId, null)).resolves.toEqual({
      ok: false,
      error: 'unsafe-path',
    });
    await expect(resolveCapabilityPath(rootId, { path: 'foo.txt' })).resolves.toEqual({
      ok: false,
      error: 'unsafe-path',
    });
  });

  it('rejects literal `..` traversal in the relative path', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, '../escape.txt');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('rejects nested traversal segments (a/../../etc/passwd)', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, 'src/../../etc/passwd');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('rejects absolute Unix paths', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, '/etc/passwd');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('rejects Windows drive-letter paths', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, 'C:\\Windows\\System32');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('rejects Windows device-namespace prefixes', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, '\\\\?\\C:\\Windows');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('rejects NUL bytes in relative path segments', async () => {
    const { rootId } = mintRootCapability(tmpRoot);
    const result = await resolveCapabilityPath(rootId, 'src/bad\0name.txt');
    expect(result).toEqual({ ok: false, error: 'unsafe-path' });
  });

  it('keeps protected paths blocked even when they are under an approved broad root', async () => {
    const { rootId } = mintRootCapability(os.homedir());
    const result = await resolveCapabilityPath(rootId, '.ssh/config');
    expect(result).toEqual({ ok: false, error: 'blocked-path' });
  });
});

describe('resolveCapabilityPath symlink-out defense', () => {
  // Skip on platforms where the test runner can't create symlinks (e.g.
  // Windows without admin/Developer Mode). The realpath escape check
  // still applies — it's just not exercisable in this environment.
  const itOrSkip = process.platform === 'win32' ? it.skip : it;

  itOrSkip(
    'rejects a relative path whose realpath resolves outside the approved root',
    async () => {
      // Create a sibling directory outside the project root.
      const sibling = await mkdtemp(path.join(process.cwd(), '.tmp-lingua-cap-sibling-'));
      try {
        // Inside the project, place a symlink pointing at the sibling.
        await symlink(sibling, path.join(tmpRoot, 'escape'));

        const { rootId } = mintRootCapability(tmpRoot);
        const result = await resolveCapabilityPath(rootId, 'escape');
        // Containment passes the canonical check (escape is inside the
        // root), but the realpath probe should detect the symlink and
        // reject because the resolved target is outside.
        expect(result).toEqual({ ok: false, error: 'escapes-root' });
      } finally {
        await rm(sibling, { recursive: true, force: true });
      }
    }
  );

  itOrSkip('allows new write targets inside a symlinked approved root', async () => {
    const realProjectParent = await mkdtemp(path.join(process.cwd(), '.tmp-lingua-cap-real-'));
    const realProject = path.join(realProjectParent, 'project');
    const linkedRoot = path.join(tmpRoot, 'linked-root');
    try {
      await mkdir(realProject, { recursive: true });
      await symlink(realProject, linkedRoot);

      const { rootId, rootPath } = mintRootCapability(linkedRoot);
      const result = await resolveCapabilityPath(rootId, 'new-file.ts', 'write');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rootPath).toBe(rootPath);
        expect(result.absolutePath).toBe(
          path.join(path.normalize(await realpath(realProject)), 'new-file.ts')
        );
      }
    } finally {
      await rm(realProjectParent, { recursive: true, force: true });
    }
  });
});
