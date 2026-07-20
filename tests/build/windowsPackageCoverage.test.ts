import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BUILDER_CONFIG_PATH = resolve(__dirname, '../../electron-builder.yml');

interface WindowsTargetEntry {
  target: string;
  arch?: string[];
}

interface BuilderConfig {
  win?: {
    target?: (string | WindowsTargetEntry)[];
  };
  nsis?: {
    oneClick?: boolean;
    perMachine?: boolean;
  };
  artifactName?: string;
}

const config = load(readFileSync(BUILDER_CONFIG_PATH, 'utf-8')) as BuilderConfig;

describe('Windows package coverage', () => {
  it('pins the Windows target to one x64 NSIS installer', () => {
    const targets = config.win?.target ?? [];
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ target: 'nsis', arch: ['x64'] });
  });

  it('keeps the installer compatible with per-user silent updates', () => {
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
  });

  it('keeps the architecture in the published filename', () => {
    expect(config.artifactName).toContain('${arch}');
  });
});
