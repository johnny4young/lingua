import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { flattenMessages, validateLocaleTree } from '../../scripts/check-i18n.mjs';

const tempDirs: string[] = [];

async function createLocales(structure: Record<string, Record<string, unknown>>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-i18n-'));
  tempDirs.push(root);

  for (const [language, namespaces] of Object.entries(structure)) {
    const languageDir = path.join(root, language);
    await mkdir(languageDir, { recursive: true });

    for (const [namespace, json] of Object.entries(namespaces)) {
      await writeFile(
        path.join(languageDir, `${namespace}.json`),
        JSON.stringify(json, null, 2),
        'utf8'
      );
    }
  }

  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('check-i18n', () => {
  it('flattens nested translation trees into semantic dot keys', () => {
    expect(
      [...flattenMessages({ settings: { title: 'Workspace Settings' } }).entries()]
    ).toEqual([['settings.title', 'Workspace Settings']]);
  });

  it('passes when locale namespaces and keys match the source locale', async () => {
    const localesRoot = await createLocales({
      en: {
        common: {
          toolbar: { run: 'Run' },
          settings: { title: 'Workspace Settings' },
        },
      },
      es: {
        common: {
          toolbar: { run: 'Ejecutar' },
          settings: { title: 'Configuración del espacio de trabajo' },
        },
      },
    });

    await expect(validateLocaleTree(localesRoot)).resolves.toMatchObject({
      issues: [],
      languages: ['en', 'es'],
    });
  });

  it('reports missing and orphaned translation keys with actionable paths', async () => {
    const localesRoot = await createLocales({
      en: {
        common: {
          toolbar: { run: 'Run' },
        },
      },
      es: {
        common: {
          toolbar: { stop: 'Detener' },
        },
      },
    });

    await expect(validateLocaleTree(localesRoot)).resolves.toMatchObject({
      issues: [
        'es/common: missing key "toolbar.run"',
        'es/common: orphan key "toolbar.stop"',
      ],
    });
  });

  it('fails on invalid locale JSON structures instead of silently accepting them', async () => {
    const localesRoot = await createLocales({
      en: {
        common: {
          toolbar: ['Run'],
        },
      },
      es: {
        common: {
          toolbar: { run: 'Ejecutar' },
        },
      },
    });

    await expect(validateLocaleTree(localesRoot)).rejects.toThrow(
      'Expected "toolbar" to resolve to a string or nested object, received array.'
    );
  });
});
