import { describe, expect, it } from 'vitest';
import {
  MAX_CAPSULE_WORKSPACE_FILE_BYTES,
  MAX_CAPSULE_WORKSPACE_FILES,
  buildCapsuleWorkspace,
  capsuleWorkspaceFilename,
  normalizeCapsuleWorkspacePath,
  parseCapsuleWorkspace,
} from '../../src/shared/capsuleWorkspace';
import { FIXTURE_FULL_TS } from './runCapsule.fixtures';

describe('Capsule Workspace artifact', () => {
  it('builds and parses a deterministic bounded multi-file companion', async () => {
    const built = await buildCapsuleWorkspace(
      FIXTURE_FULL_TS,
      [
        {
          path: 'src/math.ts',
          language: 'typescript',
          content: 'export const sum = (a: number, b: number) => a + b;\n',
        },
        {
          path: 'README.md',
          language: 'markdown',
          content: '# Demo\n',
        },
      ],
      Date.UTC(2026, 7, 1)
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.files).toHaveLength(2);
    expect(built.value.files[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(built.value.privacy).toEqual({
      sourceReview: 'explicit',
      absolutePathsIncluded: false,
      obviousSecretsDetected: 0,
    });
    expect(built.json).not.toContain('/Users/');

    const parsed = parseCapsuleWorkspace(built.json);
    expect(parsed).toEqual({ ok: true, value: built.value });
    expect(capsuleWorkspaceFilename(built.value)).toBe(
      'lingua-capsule-workspace-2026-08-01-00000000.json'
    );
  });

  it('records obvious-secret findings without mutating selected source', async () => {
    const secret = 'sk-example_abcdefghijklmnop';
    const built = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
      {
        path: 'config.ts',
        language: 'typescript',
        content: `const API_KEY = "${secret}";`,
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.privacy.obviousSecretsDetected).toBeGreaterThan(0);
    expect(built.value.files[0]?.content).toContain(secret);
  });

  it.each([
    '/tmp/secret.ts',
    'C:/Users/demo/secret.ts',
    '../secret.ts',
    'src/../secret.ts',
    'src\\secret.ts',
    'src//secret.ts',
  ])('rejects non-portable path %s', path => {
    expect(normalizeCapsuleWorkspacePath(path)).toBeNull();
  });

  it('rejects duplicate portable paths, oversized files, and too many files', async () => {
    const duplicate = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
      { path: 'src/App.ts', language: 'typescript', content: 'one' },
      { path: 'src/app.ts', language: 'typescript', content: 'two' },
    ]);
    expect(duplicate).toMatchObject({ ok: false, reason: 'duplicate-path' });

    const oversized = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
      {
        path: 'large.ts',
        language: 'typescript',
        content: 'x'.repeat(MAX_CAPSULE_WORKSPACE_FILE_BYTES + 1),
      },
    ]);
    expect(oversized).toMatchObject({ ok: false, reason: 'file-too-large' });

    const tooMany = await buildCapsuleWorkspace(
      FIXTURE_FULL_TS,
      Array.from({ length: MAX_CAPSULE_WORKSPACE_FILES + 1 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        language: 'typescript',
        content: '',
      }))
    );
    expect(tooMany).toMatchObject({ ok: false, reason: 'too-many-files' });
  });

  it('rejects tampered wrapper metadata and nested capsules', async () => {
    const built = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
      { path: 'src/helper.ts', language: 'typescript', content: 'export {};' },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const wrongVersion = { ...built.value, version: 2 };
    expect(parseCapsuleWorkspace(JSON.stringify(wrongVersion))).toMatchObject({
      ok: false,
      reason: 'unsupported-version',
    });

    const invalidCapsule = {
      ...built.value,
      capsule: { ...built.value.capsule, result: null },
    };
    expect(parseCapsuleWorkspace(JSON.stringify(invalidCapsule))).toMatchObject({
      ok: false,
      reason: 'invalid-capsule',
    });

    const absolutePath = {
      ...built.value,
      files: [{ ...built.value.files[0], path: '/private/helper.ts' }],
    };
    expect(parseCapsuleWorkspace(JSON.stringify(absolutePath))).toMatchObject({
      ok: false,
      reason: 'invalid-path',
    });
  });

  it('recomputes advisory secret findings instead of trusting sender metadata', async () => {
    const built = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
      {
        path: 'config.ts',
        language: 'typescript',
        content: 'const token = "ghp_123456789012345678901234567890123456";',
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tampered = {
      ...built.value,
      privacy: { ...built.value.privacy, obviousSecretsDetected: 0 },
    };
    const parsed = parseCapsuleWorkspace(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.privacy.obviousSecretsDetected).toBeGreaterThan(0);
  });

  it('fails closed when asked to build around an invalid nested capsule', async () => {
    const invalid = {
      ...FIXTURE_FULL_TS,
      result: null,
    } as unknown as typeof FIXTURE_FULL_TS;
    await expect(
      buildCapsuleWorkspace(invalid, [
        { path: 'src/helper.ts', language: 'typescript', content: 'export {};' },
      ])
    ).resolves.toMatchObject({ ok: false, reason: 'invalid-capsule' });
  });
});
