import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertMacBinarySupportsArch,
  inferPackagedMacArch,
  parseMacBinaryArchitectures,
  selectPackagedMacArtifact,
} from '../../scripts/lib/packagedMacArtifact.mjs';
import { assertPackagedMacProjectTerminalRuntime } from '../../scripts/lib/packagedProjectTerminal.mjs';
import { inspectDesktopSmokeResult } from '../../scripts/lib/desktopSmokeSummary.mjs';

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts/run-desktop-smoke.mjs');

describe('scripts/run-desktop-smoke.mjs', () => {
  it('selects the Apple Silicon app instead of the first Intel app on arm64', () => {
    const candidates = ['/tmp/out-builder/mac/lingua.app', '/tmp/out-builder/mac-arm64/lingua.app'];

    expect(selectPackagedMacArtifact(candidates, 'arm64')).toBe(candidates[1]);
    expect(selectPackagedMacArtifact(candidates, 'x64')).toBe(candidates[0]);
  });

  it('recognizes current electron-builder and legacy Forge archive names', () => {
    expect(inferPackagedMacArch('/tmp/Lingua-0.13.0-mac-arm64.zip')).toBe('arm64');
    expect(inferPackagedMacArch('/tmp/Lingua-darwin-x64-0.12.0.zip')).toBe('x64');
  });

  it('fails rather than validating an Intel-only artifact under Rosetta', () => {
    expect(() => selectPackagedMacArtifact(['/tmp/out-builder/mac/lingua.app'], 'arm64')).toThrow(
      /No arm64 macOS artifact found/u
    );
  });

  it('checks the executable architecture when the input path is ambiguous', () => {
    expect([
      ...parseMacBinaryArchitectures(
        'Mach-O universal binary with 2 architectures: [x86_64] [arm64]'
      ),
    ]).toEqual(['arm64', 'x64']);
    expect(() =>
      assertMacBinarySupportsArch(
        'Mach-O 64-bit executable x86_64',
        'arm64',
        '/tmp/Lingua.app/Contents/MacOS/Lingua'
      )
    ).toThrow(/does not support host architecture arm64; detected x64/u);
  });

  it('requires the packaged node-pty addon and an executable spawn helper', async () => {
    const appPath = mkdtempSync(resolve(tmpdir(), 'lingua-packaged-terminal-'));
    const nativeRoot = resolve(
      appPath,
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release'
    );
    mkdirSync(nativeRoot, { recursive: true });
    writeFileSync(resolve(nativeRoot, 'pty.node'), 'native-addon');
    writeFileSync(resolve(nativeRoot, 'spawn-helper'), '#!/bin/sh\n');
    chmodSync(resolve(nativeRoot, 'spawn-helper'), 0o755);

    await expect(assertPackagedMacProjectTerminalRuntime(appPath)).resolves.toEqual({
      addonPath: resolve(nativeRoot, 'pty.node'),
      helperPath: resolve(nativeRoot, 'spawn-helper'),
    });

    chmodSync(resolve(nativeRoot, 'spawn-helper'), 0o644);
    await expect(assertPackagedMacProjectTerminalRuntime(appPath)).rejects.toThrow(
      /spawn-helper is not executable/u
    );
  });

  it('fails fast when --against-packaged is missing its path', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--against-packaged'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--against-packaged requires a path');
  });

  it('fails fast when --against-packaged consumes another flag as its path', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--against-packaged', '--offline'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--against-packaged requires a path');
  });

  it('rejects an error summary even when every captured case passed', () => {
    const result = inspectDesktopSmokeResult(
      {
        cases: [{ caseId: 'javascript', language: 'javascript', ok: true }],
        error: 'Desktop smoke editor did not become interactive within 10000ms.',
      },
      { status: 'failed' }
    );

    expect(result.ok).toBe(false);
    expect(result.failedCases).toEqual([]);
    expect(result.problems).toEqual([
      'Renderer smoke error: Desktop smoke editor did not become interactive within 10000ms.',
      'Smoke progress status is failed, expected completed.',
    ]);
  });

  it('accepts a completed summary with successful cases', () => {
    const result = inspectDesktopSmokeResult(
      { cases: [{ caseId: 'javascript', language: 'javascript', ok: true }] },
      { status: 'completed' }
    );

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
});
