// SPDX-License-Identifier: MIT

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { PROJECT_TEMPLATES } from '../../src/renderer/data/projectTemplates';
import {
  PROJECT_TEMPLATE_SMOKE_IDS,
  assertProjectTemplateSmokeCoverage,
  materializeProjectTemplate,
} from '../../scripts/lib/projectTemplateRuntimeSmoke.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'smoke-project-templates.mjs');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe('project template runtime smoke', () => {
  it('covers every curated template exactly once', () => {
    expect(PROJECT_TEMPLATE_SMOKE_IDS).toEqual(PROJECT_TEMPLATES.map(template => template.id));
    expect(() => assertProjectTemplateSmokeCoverage(PROJECT_TEMPLATES)).not.toThrow();
  });

  it('fails closed when a catalog template has no runtime case', () => {
    const extra = {
      ...PROJECT_TEMPLATES[0],
      id: 'uncovered-template',
    };
    expect(() => assertProjectTemplateSmokeCoverage([...PROJECT_TEMPLATES, extra])).toThrow(
      /missing: uncovered-template/u
    );
  });

  it('materializes nested files byte-for-byte', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-template-materialize-'));
    temporaryRoots.push(root);
    const template = PROJECT_TEMPLATES.find(item => item.id === 'express-api-hello');
    expect(template).toBeDefined();
    await materializeProjectTemplate(template!, root);
    await expect(readFile(path.join(root, 'src', 'index.js'), 'utf8')).resolves.toBe(
      template!.files.find(file => file.relPath === 'src/index.js')!.content
    );
  });

  it('documents its command-line contract without installing packages', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Materialize, install, and execute every curated');
    expect(result.stdout).toContain('--python <path>');
  });

  it('fails fast on a missing option value', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--python'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--python requires a value');
  });
});
