import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { ensureNodePtyHelperModes } from '../../scripts/ensure-node-pty-helper-mode.mjs';
import mainConfigExport from '../../vite.main.config.mts';

const root = resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const workspace = load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as {
  allowBuilds?: Record<string, boolean>;
};
const builder = load(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')) as {
  asarUnpack?: string[];
};

async function resolveMainExternal(): Promise<unknown> {
  const config =
    typeof mainConfigExport === 'function'
      ? await mainConfigExport({
          command: 'build',
          mode: 'production',
          isSsrBuild: false,
          isPreview: false,
        })
      : mainConfigExport;
  return config.build?.rollupOptions?.external;
}

describe('project terminal desktop packaging', () => {
  it('ships node-pty as an approved production native dependency', () => {
    expect(packageJson.dependencies?.['node-pty']).toBe('1.1.0');
    expect(packageJson.devDependencies?.['node-pty']).toBeUndefined();
    expect(workspace.allowBuilds?.['node-pty']).toBe(true);
    expect(builder.asarUnpack).toContain('**/*.node');
    expect(packageJson.scripts?.prepare).toContain('ensure-node-pty-helper-mode.mjs');
    expect(packageJson.scripts?.['build:desktop-bundles']).toContain('prepare:node-pty');
  });

  it('restores the executable bit stripped from the Unix spawn helper', async () => {
    const nodePtyRoot = mkdtempSync(resolve(tmpdir(), 'lingua-node-pty-'));
    const helper = resolve(nodePtyRoot, 'prebuilds', 'darwin-arm64', 'spawn-helper');
    mkdirSync(resolve(helper, '..'), { recursive: true });
    writeFileSync(helper, '#!/bin/sh\n');
    chmodSync(helper, 0o644);

    await expect(ensureNodePtyHelperModes({ nodePtyRoot, platform: 'darwin' })).resolves.toEqual([
      helper,
    ]);
    expect(statSync(helper).mode & 0o111).toBe(0o111);
  });

  it('keeps node-pty external to the architecture-neutral Vite main bundle', async () => {
    const external = await resolveMainExternal();
    expect(external).toEqual(expect.arrayContaining(['electron', 'node-pty']));
    expect(
      readFileSync(resolve(root, 'scripts/run-electron-stagewright-smoke.mjs'), 'utf8')
    ).toContain("'--external:node-pty'");
    expect(readFileSync(resolve(root, 'scripts/run-desktop-smoke.mjs'), 'utf8')).toContain(
      'assertPackagedMacProjectTerminalRuntime(resolvedAppPath)'
    );
  });
});
